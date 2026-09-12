'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { ImporterManager } = requireDist('utcp/utils/asset-importers/importer-manager.js');

function invoke(args, request) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return new AssetTools().assetImportSettingsSet(args).finally(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  });
}

describe('assetImportSettingsSet', () => {
  it('rejects unbounded or malformed property paths before IPC', async () => {
    const calls = [];
    for (const path of ['', ' bad', 'a..b', 'a'.repeat(129)]) {
      await assert.rejects(
        invoke({ reference: { id: 'asset' }, path, value: true }, async (...args) => { calls.push(args); }),
        (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
      );
    }
    assert.equal(calls.length, 0);
  });

  it('preflights typed mutable paths, reimports, and verifies read-back', async () => {
    let value = false;
    const calls = [];
    ImporterManager.getInstance().registerImporter({
      name: 'roundtrip-test',
      className: 'RoundtripTestImporter',
      async getProperties() {
        return { enabled: { value, type: 'Boolean', displayName: 'Enabled' } };
      },
      async setProperty(_asset, path, next) {
        assert.equal(path, 'enabled');
        value = next;
        return true;
      },
    });
    const asset = { uuid: 'asset', type: 'cc.Asset', url: 'db://assets/a', name: 'a', importer: 'roundtrip-test' };
    const result = await invoke({ reference: { id: 'asset' }, path: 'enabled', value: true }, async (service, message) => {
      calls.push([service, message]);
      if (message === 'query-asset-info') return asset;
      if (message === 'reimport-asset') return true;
      throw new Error(`Unexpected request ${service}.${message}`);
    });

    assert.equal(result.changed, true);
    assert.equal(result.previous, false);
    assert.equal(result.readBack, true);
    assert.equal(result.result.settings.enabled, true);
    assert.equal(calls.filter(([, message]) => message === 'reimport-asset').length, 1);
  });

  it('rejects read-only paths before mutation', async () => {
    let setCalls = 0;
    ImporterManager.getInstance().registerImporter({
      name: 'readonly-test',
      className: 'ReadonlyTestImporter',
      async getProperties() { return { content: { value: 'source', type: 'String', readonly: true } }; },
      async setProperty() { setCalls++; return true; },
    });
    const asset = { uuid: 'asset', type: 'cc.Asset', url: 'db://assets/a', name: 'a', importer: 'readonly-test' };
    await assert.rejects(
      invoke({ reference: { id: 'asset' }, path: 'content', value: 'changed' }, async () => asset),
      (error) => error.code === 'READ_ONLY_PROPERTY' && error.status === 422,
    );
    assert.equal(setCalls, 0);
  });

  it('rolls back when post-reimport read-back differs', async () => {
    let value = false;
    let exposeStaleReadBack = false;
    const writes = [];
    let reimports = 0;
    ImporterManager.getInstance().registerImporter({
      name: 'rollback-test',
      className: 'RollbackTestImporter',
      async getProperties() {
        return { enabled: { value: exposeStaleReadBack ? false : value, type: 'Boolean' } };
      },
      async setProperty(_asset, _path, next) {
        value = next;
        writes.push(next);
        return true;
      },
    });
    const asset = { uuid: 'asset', type: 'cc.Asset', url: 'db://assets/a', name: 'a', importer: 'rollback-test' };
    await assert.rejects(
      invoke({ reference: { id: 'asset' }, path: 'enabled', value: true }, async (_service, message) => {
        if (message === 'query-asset-info') return asset;
        if (message === 'reimport-asset') {
          reimports++;
          if (reimports === 1) exposeStaleReadBack = true;
          return true;
        }
        throw new Error(`Unexpected message ${message}`);
      }),
      (error) => error.code === 'READBACK_MISMATCH' && error.status === 502,
    );
    assert.deepEqual(writes, [true, false]);
    assert.equal(value, false);
    assert.equal(reimports, 2);
  });

  it('declares a strict mutation contract', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'assetImportSettingsSet');
    assert.ok(metadata);
    assert.deepEqual(metadata.tool.inputs.required, ['reference', 'path', 'value']);
  });
});
