'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { P4ContractTools } = requireDist('utcp/tools/p4-contract-tools.js');

afterEach(() => { delete global.Editor; });

describe('particlePlayback', () => {
  it('returns typed runtime particle state through a verified session', async () => {
    global.Editor = { Message: { request: async (service, message) => {
      if (service === 'scene' && message === 'execute-scene-script') return { playing: true, operation: 'play', nodeUuid: 'particle' };
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    const tools = new P4ContractTools();
    tools.runtimeTools = undefined;
    const source = requireDist('utcp/tools/runtime-session-tools.js');
    const original = source.RuntimeSessionTools.prototype.runtimeSessionLifecycle;
    source.RuntimeSessionTools.prototype.runtimeSessionLifecycle = async () => ({ success: true, operation: 'inspect', ready: true });
    try {
      const result = await tools.particlePlayback({ sessionId: 'runtime-1', operation: 'play', nodeReference: { id: 'particle' } });
      assert.equal(result.success, true);
      assert.equal(result.state.playing, true);
    } finally {
      source.RuntimeSessionTools.prototype.runtimeSessionLifecycle = original;
    }
  });

  it('rejects unsupported operations before runtime dispatch', async () => {
    const tools = new P4ContractTools();
    await assert.rejects(
      tools.particlePlayback({ sessionId: 'runtime-1', operation: 'seek', nodeReference: { id: 'particle' } }),
      (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });
});
