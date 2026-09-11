'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { InstanceReferenceSchema } = requireDist('utcp/schemas.js');

function invoke(request, args) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return new AssetTools().assetImportSettingsGet(args).finally(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  });
}

describe('assetImportSettingsGet', () => {
  it('returns normalized generic settings and explicit source metadata', async () => {
    const calls = [];
    const result = await invoke(async (service, message, id) => {
      calls.push([service, message, id]);
      assert.equal(service, 'asset-db');
      assert.equal(message, 'query-asset-info');
      return {
        uuid: 'asset-uuid',
        url: 'db://assets/scripts/main.ts',
        type: 'cc.TSAsset',
        name: 'main.ts',
        importer: 'typescript',
        isDirectory: 0,
        importerSettings: {
          loadAsModule: true,
          nested: { sourceMap: false, targets: ['editor', 'preview'] },
        },
        meta: { shouldNotBeUsed: true },
        unexpected: { private: 'metadata' },
      };
    }, { reference: { id: 'requested-id', type: 'cc.TSAsset' } });

    assert.deepEqual(calls, [['asset-db', 'query-asset-info', 'requested-id']]);
    assert.deepEqual(result, {
      reference: { id: 'asset-uuid', type: 'cc.TSAsset' },
      importer: 'typescript',
      settings: {
        loadAsModule: true,
        nested: { sourceMap: false, targets: ['editor', 'preview'] },
      },
      source: {
        uuid: 'asset-uuid',
        url: 'db://assets/scripts/main.ts',
        type: 'cc.TSAsset',
        name: 'main.ts',
        isDirectory: false,
      },
    });
  });

  it('rejects malformed references as typed 400 errors without querying', async () => {
    const calls = [];
    const request = async (...args) => {
      calls.push(args);
      return null;
    };
    const malformed = [
      undefined,
      {},
      { reference: null },
      { reference: { id: '' } },
      { reference: { id: ' asset-id' } },
      { reference: { id: 42 } },
      { reference: { id: 'asset-id', type: '' } },
      { reference: { id: 'asset-id', type: 42 } },
      { reference: { id: 'asset-id', type: 'x'.repeat(129) } },
    ];

    for (const args of malformed) {
      await assert.rejects(
        invoke(request, args),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    assert.deepEqual(calls, []);
  });

  it('returns typed not-found and asset-query failures', async () => {
    await assert.rejects(
      invoke(async () => null, { reference: { id: 'missing' } }),
      (error) => error.code === 'TARGET_NOT_FOUND' && error.status === 404,
    );
    await assert.rejects(
      invoke(async () => { throw new Error('asset-db unavailable'); }, { reference: { id: 'asset-id' } }),
      (error) => error.code === 'ASSET_QUERY_FAILED' && error.status === 502,
    );
    await assert.rejects(
      invoke(async () => ({}), { reference: { id: 'asset-id' } }),
      (error) => error.code === 'ASSET_QUERY_FAILED' && error.status === 502,
    );
  });

  it('bounds settings recursively and excludes unsupported or cyclic metadata', async () => {
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${String(index).padStart(3, '0')}`, index]));
    const array = Array.from({ length: 100 }, (_, index) => index);
    const deep = {};
    let cursor = deep;
    for (let index = 0; index < 12; index++) {
      cursor.child = {};
      cursor = cursor.child;
    }
    const cyclic = { name: 'cycle' };
    cyclic.self = cyclic;

    const result = await invoke(async () => ({
      uuid: 'asset-id',
      url: 'u'.repeat(2048),
      type: 'cc.Asset',
      name: 'n'.repeat(500),
      importer: 'generic',
      importerSettings: {
        long: 'x'.repeat(3000),
        wide,
        array,
        deep,
        cyclic,
        unsupported: () => 'not JSON',
      },
    }), { reference: { id: 'asset-id' } });

    assert.equal(result.settings.long.length, 2048);
    assert.equal(Object.keys(result.settings.wide).length, 64);
    assert.equal(result.settings.array.length, 64);
    assert.deepEqual(result.settings.cyclic, { name: 'cycle' });
    assert.equal(Object.hasOwn(result.settings, 'unsupported'), false);

    let depth = 0;
    let node = result.settings.deep;
    while (node && typeof node === 'object' && Object.hasOwn(node, 'child')) {
      depth++;
      node = node.child;
    }
    assert.ok(depth <= 5);
    assert.equal(result.source.url.length, 2048);
    assert.equal(result.source.name.length, 256);
    assert.equal(Object.hasOwn(result.source, 'unexpected'), false);
  });

  it('declares the shared reference schema and bounded generic output shape', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'assetImportSettingsGet');
    assert.ok(metadata);
    assert.equal(metadata.tool.inputs.properties.reference, InstanceReferenceSchema);
    assert.equal(metadata.tool.outputs.properties.reference, InstanceReferenceSchema);
    assert.equal(metadata.tool.outputs.properties.settings.maxProperties, 64);
    assert.equal(metadata.tool.outputs.properties.source.additionalProperties, false);
    assert.deepEqual(metadata.tool.outputs.properties.source.required, ['uuid', 'url', 'type', 'name', 'isDirectory']);
  });
});
