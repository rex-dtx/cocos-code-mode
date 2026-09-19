'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { P4ContractTools } = requireDist('utcp/tools/p4-contract-tools.js');

function withEditor(request, run) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  });
}

describe('P4 fail-closed contracts', () => {
  it('maps physics configuration to the typed 3.7 unsupported project writer', async () => {
    await withEditor(async () => { throw new Error('Message does not exist: project - set-config'); }, async () => {
      const tools = new P4ContractTools();
      await assert.rejects(() => tools.physics2dConfigure({ path: 'gravity', value: 9.8 }), error => error.code === 'UNSUPPORTED_EDITOR_API' && error.status === 422);
      await assert.rejects(() => tools.physics3dConfigure({ path: 'gravity', value: 9.8 }), error => error.code === 'UNSUPPORTED_EDITOR_API' && error.status === 422);
    });
  });
  it('returns verified physics settings read-back when Creator exposes project/set-config', async () => {
    const config = { physics: { gravity: 9.8 } };
    await withEditor(async (service, message, scope, path, value) => {
      assert.equal(service, 'project');
      if (message === 'set-config') {
        assert.equal(scope, 'project');
        assert.equal(path, 'physics.gravity');
        assert.equal(value, 9.8);
        return true;
      }
      assert.equal(message, 'query-config');
      assert.equal(scope, 'project');
      return config;
    }, async () => {
      const result = await new P4ContractTools().physics2dConfigure({ path: 'physics.gravity', value: 9.8 });
      assert.deepEqual(result, { success: true, path: 'physics.gravity', readBack: 9.8 });
    });
  });

  it('rejects unknown particle sessions before any playback claim', async () => {
    await withEditor(async () => { throw new Error('Message does not exist: scene - execute-scene-script'); }, async () => {
      await assert.rejects(
        () => new P4ContractTools().particlePlayback({ sessionId: 'missing', operation: 'play', nodeReference: { id: 'node' } }),
        error => error.code === 'SESSION_NOT_FOUND' && error.status === 404,
      );
    });
  });
});
