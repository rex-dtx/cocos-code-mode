'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { assetQueryMemo } = requireDist('utcp/utils/memo-cache.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { InstanceReferenceSchema } = requireDist('utcp/schemas.js');

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
  try {
    return await new AssetTools().assetUsageAnalyze(args);
  } finally {
    restore();
  }
}

describe('assetUsageAnalyze', () => {
  it('sorts by URL then UUID before applying the asset bound and returns bounded reference evidence', async () => {
    const sceneCalls = [];
    const result = await invoke(async (service, message, optionsOrUuid) => {
      if (service === 'asset-db') {
        assert.equal(message, 'query-assets');
        assert.deepEqual(optionsOrUuid, { pattern: 'db://assets/sprites/**' });
        return [
          { uuid: 'z', url: 'db://assets/sprites/b.png', type: 'cc.Texture2D', isDirectory: false },
          { uuid: 'a2', url: 'db://assets/sprites/a.png', type: 'cc.Texture2D', isDirectory: false },
          { uuid: 'a1', url: 'db://assets/sprites/a.png', type: 'cc.Texture2D', isDirectory: false },
          { uuid: 'directory', url: 'db://assets/sprites', isDirectory: true },
        ];
      }
      assert.equal(service, 'scene');
      assert.equal(message, 'query-nodes-by-asset-uuid');
      sceneCalls.push(optionsOrUuid);
      return optionsOrUuid === 'a1' ? [] : Array.from({ length: 140 }, (_, index) => `node-${index}`);
    }, { assetPath: ' assets\\sprites/ ', maxAssets: 2 });

    assert.deepEqual(sceneCalls, ['a1', 'a2']);
    assert.deepEqual(result.candidates.map((asset) => asset.uuid), ['a1']);
    assert.equal(result.checkedAssets, 2);
    assert.equal(result.referenceEvidence[0].status, 'unreferenced');
    assert.equal(result.referenceEvidence[1].status, 'referenced');
    assert.equal(result.referenceEvidence[1].referenceCount, 140);
    assert.equal(result.referenceEvidence[1].references.length, 128);
    assert.equal(result.referenceEvidence[1].truncated, true);
    assert.match(result.referenceQueryCaveat, /unknown status.*never classified as unreferenced/);
    assert.match(result.dynamicLoadCaveat, /closed scenes/);
    assert.match(result.dynamicLoadCaveat, /prefabs/);
    assert.match(result.dynamicLoadCaveat, /serialized asset-to-asset references/);
    assert.match(result.dynamicLoadCaveat, /addressables/);
  });

  it('rejects malformed asset paths and maxAssets as typed 400 errors before querying', async () => {
    const calls = [];
    const request = async (...args) => {
      calls.push(args);
      return [];
    };
    for (const maxAssets of [0, 129, 1.5, NaN, Infinity, '2']) {
      await assert.rejects(
        invoke(request, { maxAssets }),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    for (const assetPath of ['', 'db://assets/../outside', 'db://internal', 'x'.repeat(257), 42]) {
      await assert.rejects(
        invoke(request, { assetPath }),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    assert.deepEqual(calls, []);
  });

  it('wraps asset database query failures as typed 502 errors', async () => {
    await assert.rejects(
      invoke(async () => { throw new Error('asset-db unavailable'); }, { maxAssets: 1 }),
      (error) => error.code === 'ASSET_QUERY_FAILED' && error.status === 502,
    );
  });

  it('reports reference query errors as unknown and never as unreferenced', async () => {
    const result = await invoke(async (service, message, value) => {
      if (service === 'asset-db') {
        assert.equal(message, 'query-assets');
        return [{ uuid: 'broken', url: 'db://assets/broken.png', type: 'cc.Texture2D', isDirectory: false }];
      }
      assert.equal(service, 'scene');
      assert.equal(message, 'query-nodes-by-asset-uuid');
      assert.equal(value, 'broken');
      throw new Error('scene index unavailable');
    }, { maxAssets: 1 });

    assert.deepEqual(result.candidates, []);
    assert.equal(result.referenceEvidence.length, 1);
    assert.equal(result.referenceEvidence[0].status, 'unknown');
    assert.equal(Object.hasOwn(result.referenceEvidence[0], 'referenceCount'), false);
    assert.equal(result.referenceEvidence[0].error, 'scene index unavailable');
  });

  it('declares bounded instance-reference arrays and optional unknown counts', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'assetUsageAnalyze');
    assert.ok(metadata);
    const output = metadata.tool.outputs;
    const candidates = output.properties.candidates;
    const evidence = output.properties.referenceEvidence;

    assert.equal(candidates.maxItems, 128);
    assert.equal(candidates.items.properties.references.maxItems, 128);
    assert.deepEqual(candidates.items.properties.references.items, InstanceReferenceSchema);
    assert.equal(evidence.maxItems, 128);
    assert.equal(evidence.items.properties.references.maxItems, 128);
    assert.deepEqual(evidence.items.properties.references.items, InstanceReferenceSchema);
    assert.equal(evidence.items.required.includes('referenceCount'), false);
  });

  it('returns a positive unreferenced candidate when the scene query is empty', async () => {
    const result = await invoke(async (service, message) => {
      if (service === 'asset-db') {
        assert.equal(message, 'query-assets');
        return [{ uuid: 'unused', url: 'db://assets/unused.png', type: 'cc.Texture2D', isDirectory: false }];
      }
      assert.equal(service, 'scene');
      assert.equal(message, 'query-nodes-by-asset-uuid');
      return [];
    }, { maxAssets: 1 });

    assert.deepEqual(result.candidates, [{
      uuid: 'unused',
      url: 'db://assets/unused.png',
      type: 'cc.Texture2D',
      confidence: 'scene-unreferenced',
      referenceCount: 0,
      references: [],
    }]);
  });
});
