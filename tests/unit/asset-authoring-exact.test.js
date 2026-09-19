'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { assetQueryMemo } = requireDist('utcp/utils/memo-cache.js');

function install(request) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return () => {
    assetQueryMemo.invalidate();
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  };
}

describe('exact asset authoring adapters', () => {
  it('finds assets by exact name with authoritative bounded records', async () => {
    const rows = [
      { uuid: 'a', name: 'Hero', url: 'db://assets/Hero.prefab', type: 'cc.Prefab', importer: 'prefab', isDirectory: false },
      { uuid: 'b', name: 'Hero', url: 'db://assets/Hero.scene', type: 'cc.SceneAsset', importer: 'scene', isDirectory: false },
      { uuid: 'c', name: 'Other', url: 'db://assets/Other.prefab', type: 'cc.Prefab', importer: 'prefab', isDirectory: false },
    ];
    const restore = install(async (service, message, options) => {
      assert.equal(service, 'asset-db');
      assert.equal(message, 'query-assets');
      assert.deepEqual(options, { name: 'Hero' });
      return rows;
    });
    try {
      const result = await new AssetTools().assetQuery({ name: 'Hero', limit: 1 });
      assert.equal(result.total, 2);
      assert.equal(result.truncated, true);
      assert.deepEqual(result.assets, [{ uuid: 'a', name: 'Hero', url: 'db://assets/Hero.prefab', type: 'cc.Prefab', importer: 'prefab', isDirectory: false }]);
    } finally { restore(); }
  });

  it('returns asset identity, metadata, and bounded serialized data', async () => {
    const info = { uuid: 'asset-id', url: 'db://assets/config.json', type: 'cc.JsonAsset', file: 'C:/project/assets/config.json', importer: 'json', isDirectory: false };
    const meta = { imported: true, userData: { schema: 'v1' } };
    const rawData = { enabled: true, label: 'hello' };
    const calls = [];
    const restore = install(async (service, message, id) => {
      calls.push([service, message, id]);
      if (message === 'query-asset-info') return info;
      if (message === 'query-asset-meta') return meta;
      if (message === 'query-asset-data') return rawData;
      throw new Error(`Unexpected ${service}.${message}`);
    });
    try {
      const result = await new AssetTools().assetInspect({ reference: { id: 'asset-id' }, maxDataBytes: 1024 });
      assert.deepEqual(result, {
        uuid: 'asset-id', url: info.url, type: info.type, file: info.file, isDirectory: false,
        importer: 'json', meta, data: rawData, dataBytes: JSON.stringify(rawData).length, dataTruncated: false,
      });
      assert.deepEqual(calls, [
        ['asset-db', 'query-asset-info', 'asset-id'],
        ['asset-db', 'query-asset-meta', 'asset-id'],
        ['asset-db', 'query-asset-data', 'asset-id'],
      ]);
    } finally { restore(); }
  });

  it('registers the exact query and inspection contracts', () => {
    const names = ToolRegistry.getTools().map(({ tool }) => tool.name);
    assert.ok(names.includes('assetQuery'));
    assert.ok(names.includes('assetInspect'));
  });
});
