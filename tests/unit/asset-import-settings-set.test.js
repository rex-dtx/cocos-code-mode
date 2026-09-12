'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

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

  it('declares a strict mutation contract', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'assetImportSettingsSet');
    assert.ok(metadata);
    assert.deepEqual(metadata.tool.inputs.required, ['reference', 'path', 'value']);
  });
});
