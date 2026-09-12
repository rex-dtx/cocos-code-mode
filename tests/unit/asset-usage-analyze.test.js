'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { assetQueryMemo } = requireDist('utcp/utils/memo-cache.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

function withEditor(request) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return () => {
    assetQueryMemo.invalidate();
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  };
}

async function invoke(request, args) {
  const restore = withEditor(request);
  try { return await new AssetTools().assetUsageAnalyze(args); }
  finally { restore(); }
}

describe('assetUsageAnalyze', () => {
  it('builds graph-v4 reachability from serialized scene roots and reports project-unreachable assets', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-usage-'));
    const scene = path.join(root, 'main.scene');
    fs.writeFileSync(scene, JSON.stringify({ __uuid__: '11111111-1111-1111-1111-111111111111' }));
    const rows = [
      { uuid: '00000000-0000-0000-0000-000000000001', url: 'db://assets/main.scene', type: 'cc.SceneAsset', importer: 'scene', file: scene, isDirectory: false },
      { uuid: '11111111-1111-1111-1111-111111111111', url: 'db://assets/used.png', type: 'cc.ImageAsset', importer: 'image', isDirectory: false },
      { uuid: '22222222-2222-2222-2222-222222222222', url: 'db://assets/unused.png', type: 'cc.ImageAsset', importer: 'image', isDirectory: false },
    ];
    try {
      const result = await invoke(async (service, message, options) => {
        assert.equal(service, 'asset-db');
        assert.equal(message, 'query-assets');
        assert.deepEqual(options, { pattern: 'db://assets/**' });
        return rows;
      }, { assetPath: 'db://assets', maxAssets: 10 });
      assert.equal(result.graphVersion, 'v4');
      assert.equal(result.complete, true);
      assert.equal(result.roots[0].id, '00000000-0000-0000-0000-000000000001');
      assert.equal(result.graphEdges, 1);
      assert.deepEqual(result.candidates.map((item) => item.uuid), ['22222222-2222-2222-2222-222222222222']);
      assert.equal(result.referenceEvidence.find((item) => item.uuid === '11111111-1111-1111-1111-111111111111').status, 'root-reachable');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('supports explicit roots and bounded graph traversal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-usage-roots-'));
    const source = path.join(root, 'prefab.prefab');
    fs.writeFileSync(source, JSON.stringify({ __uuid__: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }));
    const rows = [
      { uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', url: 'db://assets/root.prefab', type: 'cc.Prefab', file: source, isDirectory: false },
      { uuid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', url: 'db://assets/child.png', type: 'cc.ImageAsset', isDirectory: false },
      { uuid: 'cccccccc-cccc-cccc-cccc-cccccccccccc', url: 'db://assets/orphan.png', type: 'cc.ImageAsset', isDirectory: false },
    ];
    try {
      const result = await invoke(async () => rows, { rootReferences: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }], maxGraphAssets: 2, maxAssets: 10 });
      assert.equal(result.complete, false);
      assert.deepEqual(result.roots.map((item) => item.id), ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects invalid bounds and paths before querying', async () => {
    const calls = [];
    const request = async (...args) => { calls.push(args); return []; };
    for (const args of [{ maxAssets: 0 }, { maxGraphAssets: 0 }, { assetPath: 'db://assets/../outside' }, { assetPath: 42 }]) {
      await assert.rejects(
        invoke(request, args),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    assert.deepEqual(calls, []);
  });

  it('declares graph-v4 evidence and bounded references', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'assetUsageAnalyze');
    assert.ok(metadata);
    assert.equal(metadata.tool.outputs.properties.graphVersion.const, 'v4');
    assert.equal(metadata.tool.outputs.properties.candidates.maxItems, 128);
    assert.equal(metadata.tool.inputs.properties.maxGraphAssets.maximum, 5000);
  });
});
