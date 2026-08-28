'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, healthCheck, resVal } = require('../helpers/utcp-client');

describe('live: gap-closure — findNodes, assetResolve +4, scene:new-scene NOT-EXPOSED', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  function skip(t) { if (!health || !health.ok) { t.skip(`editor not running: ${health ? health.reason : 'no health'}`); return true; } return false; }

  // G1 — assetResolvePath now has isSubAsset/containsSubAssets/relativePath/backupPath
  describe('G1 assetResolvePath +4 fields', () => {
    it('regular db://assets has isSubAsset false', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/assetResolvePath?assetPath=db://assets');
      assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 160));
      assert.equal(r.body.isSubAsset, false);
      assert.equal(typeof r.body.filesystemPath, 'string');
      assert.ok(r.body.relativePath === 'assets' || r.body.relativePath.endsWith('assets'));
    });

    it('internal texture with subAssets has containsSubAssets true', async (t) => {
      if (skip(t)) return;
      // Default-Particle.png (internal db://internal) is known to have a Texture2D @6c48a sub-asset.
      const q = await getJson('/tools/assetQuery?importer=image&limit=1');
      const img = q.body && q.body.assets && q.body.assets[0];
      if (!img) { t.skip('no image asset'); return; }
      const r = await getJson(`/tools/assetResolvePath?reference%5Bid%5D=${encodeURIComponent(img.uuid)}`);
      assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 200));
      assert.equal(r.body.containsSubAssets, true, 'internal image should contain sub-assets');
      assert.equal(r.body.isSubAsset, false);
      // internal assets live at C:\ProgramData\... — relativePath must be absent (not absolute leak)
      assert.ok(r.body.relativePath === undefined || !r.body.relativePath.startsWith('C:'), `relativePath=${r.body.relativePath}`);
    });

    it('relativePath only for files inside project, not outside', async (t) => {
      if (skip(t)) return;
      const a = await getJson('/tools/assetResolvePath?assetPath=db://assets/cc-common');
      if (!a.ok) { t.skip('cc-common not present'); return; }
      // if inside project, relativePath starts with assets; if not found, skip
      assert.ok(a.body.relativePath === undefined || a.body.relativePath.endsWith('assets') || a.body.relativePath.startsWith('assets'), `relativePath=${a.body.relativePath}`);
    });

    it('backupPath points at .meta sidecar when it exists', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/assetResolvePath?assetPath=db://assets');
      if (!r.ok) { t.skip('no db://assets'); return; }
      // db://assets maps to assets/ folder — its sidecar is assets.meta . The test is
      // deliberately weak (backupPath is optional): we only assert shape.
      assert.ok(typeof r.body.filesystemPath === 'string');
      if (r.body.backupPath != null) assert.match(r.body.backupPath, /\.meta$/);
    });
  });

  // G3 — findNodes by name / componentType
  describe('G3 findNodes', () => {
    it('by name: Canvas', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/findNodes?name=Canvas&maxResults=10');
      assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 160));
      assert.ok(Array.isArray(r.body.nodes) && r.body.nodes.length >= 1, 'at least one node');
      assert.equal(typeof r.body.nodes[0].reference.id, 'string');
      assert.ok(r.body.nodes[0].path.includes('Canvas'));
      assert.equal(r.body.truncated, false);
    });

    it('by componentType: Canvas', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/findNodes?componentType=cc.Canvas&maxResults=10');
      assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 160));
      assert.ok(r.body.nodes.length >= 1);
    });

    it('name + componentType together', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/findNodes?name=Canvas&componentType=cc.Canvas&maxResults=10');
      assert.equal(r.ok, true);
      // conjunction: name must match AND componentType must match
      assert.ok(r.body.nodes.length >= 1, 'Canvas with cc.Canvas');
    });

    it('requires at least one filter', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/findNodes?maxResults=5');
      assert.equal(r.ok, false, 'should 500');
      assert.match(String(r.body.error || r.text), /requires at least one/i);
    });

    it('path prefix is hierarchy path (contains /)', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/findNodes?name=Canvas&maxResults=5');
      assert.equal(r.ok, true);
      if (r.body.nodes.length) assert.ok(r.body.nodes[0].path.includes('/'));
    });
  });

  // G2 wired as negative evidence: scene:new-scene does not exist in 3.7.3.
  // We prove it by asking the editor (scene context) to request a non-existent
  // message and asserting the expected error. This locks in the decision to
  // keep assetCreate{scene}+sceneManage as the canonical path.
  describe('G2 scene:new-scene NOT-EXPOSED (negative)', () => {
    it('Editor.Message.request scene new-scene => Message does not exist', async (t) => {
      if (skip(t)) return;
      const r = await getJson('/tools/executeJavascript', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: 'editor', code: 'try { await Editor.Message.request("scene","new-scene"); return { ok: true }; } catch (e) { return { ok: false, msg: String(e && e.message || e) }; }' }),
      });
      assert.equal(r.ok, true, JSON.stringify(r.body).slice(0, 160));
      const v = resVal(r.body);
      assert.equal(v.ok, false, 'new-scene must error');
      assert.match(v.msg, /Message does not exist/i, `msg=${v.msg}`);
    });
  });
});
