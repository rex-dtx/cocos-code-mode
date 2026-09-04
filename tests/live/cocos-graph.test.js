'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: cocos-graph overlay', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('overlays the open scene without dropping other bundle files', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const scene = await getJson('/tools/sceneGetInfo');
    const sceneUuid = scene.body?.currentScene?.uuid;
    if (!scene.ok || !sceneUuid) { t.skip('no open saved scene'); return; }
    const asset = await getJson(`/tools/assetResolvePath?reference%5Bid%5D=${encodeURIComponent(sceneUuid)}`);
    const sourceFile = asset.body?.relativePath?.replace(/\\/g, '/');
    if (!asset.ok || !sourceFile?.endsWith('.scene')) { t.skip('open scene has no resolvable disk path'); return; }
    const tree = await getJson('/tools/nodeGetTree?verbose=true&maxDepth=99&maxNodes=10000');
    if (!tree.ok || !Array.isArray(tree.body?.children)) { t.skip('live scene tree unavailable'); return; }

    const normalizedFsPath = asset.body.filesystemPath.replace(/\\/g, '/');
    const normalizedProject = normalizedFsPath.slice(0, -(sourceFile.length + 1));
    const bundle = sourceFile.split('/')[1];
    const namespace = `.cocos-graph/live-smoke-${process.pid}`;
    const outDir = path.join(normalizedProject, namespace);
    const snapshot = path.join(os.tmpdir(), `cocos-graph-live-${process.pid}.json`);
    fs.writeFileSync(snapshot, JSON.stringify({ sourceFile, dirty: scene.body.dirty, tree: tree.body }));
    const cli = path.resolve(__dirname, '../../tools/cocos-graph/bin/cocos-graph.mjs');

    try {
      const stdout = execFileSync(process.execPath, [cli, 'build', '--project', normalizedProject, '--bundle', bundle, '--live-json', snapshot, '--out', namespace], { encoding: 'utf8' });
      const built = JSON.parse(stdout);
      assert.equal(built.ok, true);
      const shard = built.shards[0];
      assert.equal(shard.liveScene, sourceFile);
      assert.ok(['live', 'mixed'].includes(shard.source));
      const manifest = JSON.parse(fs.readFileSync(path.join(outDir, '_manifest.json'), 'utf8'));
      const graph = JSON.parse(fs.readFileSync(path.join(outDir, manifest.shards[0].graphFile), 'utf8'));
      assert.ok(graph.nodes.some((node) => node.source === 'live' && node.file === sourceFile));
      if (graph.files.length > 1) assert.ok(graph.nodes.some((node) => node.source === 'disk' && node.file !== sourceFile));
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(snapshot, { force: true });
    }
  });
});
