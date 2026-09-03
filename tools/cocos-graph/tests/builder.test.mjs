import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAll } from '../src/builder.mjs';
import { loadShard } from '../src/query.mjs';
import { readFileSync as rfs } from 'node:fs';

describe('builder per-shard', () => {
  it('builds one shard from a fixture project and marks prefabOpaque', () => {
    const fakeProject = mkdtempSync(join(tmpdir(), 'cocos-graph-builder-'));
    const assets = join(fakeProject, 'assets', 'my-bundle');
    mkdirSync(assets, { recursive: true });
    // copy fixture as a scene file
    const fixture = rfs(join(import.meta.dirname, 'fixtures', 'mini.scene.json'), 'utf8');
    writeFileSync(join(assets, 'a.scene'), fixture, 'utf8');
    // meta for the scene — uuid not needed for build, but add one
    writeFileSync(join(assets, 'a.scene.meta'), JSON.stringify({ uuid: 'scene-root-uuid', ver: '1.0.0' }), 'utf8');
    const outDir = join(fakeProject, '.cocos-graph');
    const manifest = buildAll({ project: fakeProject, outDir });
    assert.ok(manifest.shards.some((s) => s.name === 'my-bundle'));
    const shard = manifest.shards.find((s) => s.name === 'my-bundle');
    assert.equal(shard.prefabOpaque, true);
    assert.equal(shard.source, 'disk');
    const graph = loadShard(outDir, 'my-bundle');
    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.bundle, 'my-bundle');
    assert.equal(graph.version, '3');
    rmSync(fakeProject, { recursive: true, force: true });
  });

  it('live-sourced shard overrides disk and is not prefabOpaque', () => {
    const fakeProject = mkdtempSync(join(tmpdir(), 'cocos-graph-live-'));
    const assets = join(fakeProject, 'assets', 'live-bundle');
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, 'x.scene'), rfs(join(import.meta.dirname, 'fixtures', 'mini.scene.json'), 'utf8'), 'utf8');
    const liveJson = join(fakeProject, 'live.json');
    // Minimal nodeGetTree verbose shape: { reference, children }
    const liveTree = {
      reference: { id: 'live-scene-uuid', type: 'cc.Scene' },
      name: 'LiveScene',
      children: [
        { reference: { id: 'live-node-1', type: 'cc.Node' }, name: 'LivePlayer', path: '/LivePlayer', components: [{ reference: { id: 'c1', type: 'cc.Sprite' } }], children: [] },
      ],
    };
    writeFileSync(liveJson, JSON.stringify(liveTree), 'utf8');
    const outDir = join(fakeProject, '.cocos-graph');
    const manifest = buildAll({ project: fakeProject, outDir, liveJsonByBundle: { 'live-bundle': liveJson } });
    const shard = manifest.shards.find((s) => s.name === 'live-bundle');
    assert.equal(shard.source, 'live');
    assert.equal(shard.liveNodes, 1);
    assert.equal(shard.prefabOpaque, false);
    const graph = loadShard(outDir, 'live-bundle');
    assert.equal(graph.nodes.some((n) => n.name === 'LivePlayer'), true);
    rmSync(fakeProject, { recursive: true, force: true });
  });

  it('loadShard throws with exit-2 message when shard missing', () => {
    const fakeProject = mkdtempSync(join(tmpdir(), 'cocos-graph-miss-'));
    const outDir = join(fakeProject, '.cocos-graph');
    mkdirSync(outDir, { recursive: true });
    assert.throws(() => loadShard(outDir, 'no-such-bundle'), /shard not built for bundle/);
    rmSync(fakeProject, { recursive: true, force: true });
  });
});
