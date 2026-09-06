'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getJson, healthCheck } = require('../helpers/utcp-client');

function dbUrlToSourceFile(url) {
  if (typeof url !== 'string' || !url.startsWith('db://')) return null;
  return url.replace(/^db:\/\//, '');
}

function countTreeNodes(root) {
  let n = 0;
  const walk = (entry) => {
    if (!entry) return;
    if (entry.uuid || entry.reference?.id) n++;
    for (const child of Array.isArray(entry.children) ? entry.children : []) walk(child);
  };
  for (const child of Array.isArray(root.children) ? root.children : []) walk(child);
  return n;
}

describe('live: cocos-graph overlay', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('overlays the open .fire without dropping other bundle files', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const scene = await getJson('/tools/sceneInfo');
    const sceneUuid = scene.body?.uuid;
    if (!scene.ok || !sceneUuid) { t.skip('no open saved scene'); return; }

    const asset = await getJson(`/tools/assetResolve?operation=url_from_uuid&uuid=${encodeURIComponent(sceneUuid)}`);
    const sourceFile = dbUrlToSourceFile(asset.body?.url);
    if (!asset.ok || !sourceFile?.endsWith('.fire')) { t.skip('open scene has no resolvable .fire path'); return; }

    const snapshot = await getJson('/tools/sceneSnapshot?maxDepth=99&maxNodes=10000');
    if (!snapshot.ok || !Array.isArray(snapshot.body?.children)) { t.skip('live sceneSnapshot unavailable'); return; }
    if (snapshot.body.budgetExhausted === true) { t.skip('sceneSnapshot exhausted maxNodes'); return; }

    const fspath = await getJson(`/tools/assetResolve?operation=fspath&uuid=${encodeURIComponent(sceneUuid)}`);
    const filesystemPath = String(fspath.body?.fspath || '').replace(/\\/g, '/');
    if (!fspath.ok || !filesystemPath.endsWith(sourceFile)) { t.skip('open scene has no filesystem path'); return; }
    const normalizedProject = filesystemPath.slice(0, -(sourceFile.length + 1));

    const bundle = sourceFile.split('/')[1];
    const namespace = `.cocos-graph/live-smoke-${process.pid}`;
    const outDir = path.join(normalizedProject, namespace);
    const livePath = path.join(os.tmpdir(), `cocos-graph-live-${process.pid}.json`);
    const dirty = scene.body.dirty === true || scene.body.dirty === false ? scene.body.dirty : 'unknown';
    fs.writeFileSync(livePath, JSON.stringify({ sourceFile, dirty, tree: snapshot.body }));
    const cli = path.resolve(__dirname, '../../tools/cocos-graph/bin/cocos-graph.mjs');

    try {
      const stdout = execFileSync(process.execPath, [cli, 'build', '--project', normalizedProject, '--bundle', bundle, '--live-json', livePath, '--out', namespace], { encoding: 'utf8' });
      const built = JSON.parse(stdout);
      assert.equal(built.ok, true);
      assert.equal(built.engineProfile, 'creator-2.4');
      const shard = built.shards[0];
      assert.equal(shard.liveScene, sourceFile);
      assert.ok(['live', 'mixed'].includes(shard.source));
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, '_manifest.json'), 'utf8'));
      assert.equal(manifest.engineProfile, 'creator-2.4');
      const graph = JSON.parse(fs.readFileSync(path.join(outDir, manifest.shards[0].graphFile), 'utf8'));
      const liveNodes = graph.nodes.filter((node) => node.source === 'live' && node.file === sourceFile);
      assert.ok(liveNodes.length > 0);
      assert.equal(liveNodes.length, countTreeNodes(snapshot.body));
      if (graph.files.length > 1) assert.ok(graph.nodes.some((node) => node.source === 'disk' && node.file !== sourceFile));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(livePath, { force: true });
    }
  });
});
