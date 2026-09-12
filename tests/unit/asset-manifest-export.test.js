'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  it('normalizes the path, sorts assets deterministically, hashes sources, and enforces the asset bound', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-manifest-'));
    const rows = ['z', 'a', 'm'].map((uuid) => {
      const file = path.join(root, `${uuid}.txt`);
      fs.writeFileSync(file, uuid);
      return { uuid, url: `db://assets/sprites/${uuid}.png`, type: 'cc.Texture2D', importer: 'image', name: uuid.toUpperCase(), isDirectory: false, file };
    });
    const calls = [];
    try {
      const result = await invoke(async (service, message, options) => {
        calls.push({ service, message, options });
        assert.equal(service, 'asset-db');
        assert.equal(message, 'query-assets');
        if (options.pattern === 'db://assets/sprites/**') {
          return [{ uuid: 'dir', url: 'db://assets/sprites', isDirectory: true }, ...rows];
        }
        return [];
      }, { assetPath: ' assets\\sprites/ ', maxAssets: 2 });

      assert.equal(calls[0].options.pattern, 'db://assets/sprites/**');
      assert.deepEqual(result.assets.map((asset) => asset.url), [
        'db://assets/sprites/a.png',
        'db://assets/sprites/m.png',
      ]);
      assert.ok(result.assets.every((asset) => asset.sha256.length === 64 && asset.bytes === 1));
      assert.equal(result.count, 2);
      assert.equal(result.total, 3);
      assert.equal(result.truncated, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  it('includes bounded dependencies and explicit source exclusions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-manifest-deps-'));
    const source = path.join(root, 'with-deps.json');
    fs.writeFileSync(source, '{}');
    const dependencies = Array.from({ length: 140 }, (_, index) => `dep-${String(140 - index).padStart(3, '0')}`);
    dependencies.push('dep-001', 42, null);
    try {
      const result = await invoke(async (_service, message, arg) => {
        if (message === 'query-assets' && arg.pattern === 'db://assets/**') return [
          { uuid: 'with-deps', url: 'db://assets/with-deps.json', type: 'cc.JsonAsset', importer: 'json', name: 'WithDeps', isDirectory: false, file: source, depends: dependencies },
          { uuid: 'without-source', url: 'db://assets/without.json', type: 'cc.JsonAsset', importer: 'json', name: 'Without', isDirectory: false },
        ];
        if (message === 'query-assets') return [];
        if (message === 'query-asset-info') return null;
        throw new Error(`Unexpected ${message}`);
      }, { maxAssets: 2 });

      assert.equal(result.assets[0].dependencies.length, 128);
      assert.equal(result.assets[0].dependenciesTruncated, true);
      assert.deepEqual(result.assets[0].dependencies, [...result.assets[0].dependencies].sort());
      assert.deepEqual(result.exclusions, [{ uuid: 'without-source', url: 'db://assets/without.json', reason: 'source-file-unavailable' }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
