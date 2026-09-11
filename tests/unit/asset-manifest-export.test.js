'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { assetQueryMemo } = requireDist('utcp/utils/memo-cache.js');

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
    return await new AssetTools().assetManifestExport(args);
  } finally {
    restore();
  }
}

describe('assetManifestExport', () => {
  it('normalizes the path, sorts assets deterministically, and enforces the asset bound', async () => {
    const calls = [];
    const result = await invoke(async (service, message, options) => {
      calls.push({ service, message, options });
      assert.equal(service, 'asset-db');
      assert.equal(message, 'query-assets');
      return [
        { uuid: 'dir', url: 'db://assets/sprites', isDirectory: true },
        { uuid: 'z', url: 'db://assets/sprites/z.png', type: 'cc.Texture2D', name: 'Z', isDirectory: false },
        { uuid: 'a', url: 'db://assets/sprites/a.png', type: 'cc.Texture2D', name: 'A', isDirectory: false },
        { uuid: 'm', url: 'db://assets/sprites/m.png', type: 'cc.Texture2D', name: 'M', isDirectory: false },
      ];
    }, { assetPath: ' assets\\sprites/ ', maxAssets: 2 });

    assert.deepEqual(calls, [{
      service: 'asset-db',
      message: 'query-assets',
      options: { pattern: 'db://assets/sprites/**' },
    }]);
    assert.deepEqual(result.assets.map((asset) => asset.url), [
      'db://assets/sprites/a.png',
      'db://assets/sprites/m.png',
    ]);
    assert.equal(result.count, 2);
    assert.equal(result.truncated, true);
  });

  it('rejects malformed bounds and unsafe asset paths with typed 400 errors before querying', async () => {
    const calls = [];
    const request = async (...args) => {
      calls.push(args);
      return [];
    };
    for (const maxAssets of [0, 513, 1.5, NaN, Infinity]) {
      await assert.rejects(
        invoke(request, { maxAssets }),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    for (const assetPath of ['', 'db://assets/../outside', 'db://internal', 'x'.repeat(257)]) {
      await assert.rejects(
        invoke(request, { assetPath }),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    assert.deepEqual(calls, []);
  });

  it('wraps asset database failures as a typed 502 error', async () => {
    await assert.rejects(
      invoke(async () => { throw new Error('asset-db unavailable'); }, { maxAssets: 1 }),
      (error) => error.code === 'ASSET_QUERY_FAILED' && error.status === 502,
    );
  });

  it('includes only bounded Creator dependency metadata and never fabricates it', async () => {
    const dependencies = Array.from({ length: 140 }, (_, index) => `dep-${String(140 - index).padStart(3, '0')}`);
    dependencies.push('dep-001', 42, null);
    const result = await invoke(async () => [
      { uuid: 'with-deps', url: 'db://assets/with-deps.json', type: 'cc.JsonAsset', name: 'WithDeps', isDirectory: false, depends: dependencies },
      { uuid: 'without-deps', url: 'db://assets/without-deps.json', type: 'cc.JsonAsset', name: 'WithoutDeps', isDirectory: false },
    ], { maxAssets: 2 });

    assert.equal(result.assets[0].dependencies.length, 128);
    assert.deepEqual(result.assets[0].dependencies, [...result.assets[0].dependencies].sort());
    assert.equal(Object.prototype.hasOwnProperty.call(result.assets[1], 'dependencies'), false);
  });
});
