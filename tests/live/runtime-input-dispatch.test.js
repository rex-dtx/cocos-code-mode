'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, postExpectedErrorTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: runtime input dispatch', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('dispatches bounded key and pointer actions and rejects incomplete input', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('RUNTIME-INPUT-01', async () => {
      const key = await postTool('runtimeInputDispatch', { action: 'key', key: 'Escape' });
      assert.equal(key.status, 200, JSON.stringify(key.body));
      assert.deepEqual(key.body, { success: true, action: 'key', target: 'active-electron-window' });

      const click = await postTool('runtimeInputDispatch', { action: 'click', x: 1, y: 1, button: 'left' });
      assert.equal(click.status, 200, JSON.stringify(click.body));
      assert.deepEqual(click.body, { success: true, action: 'click', target: 'active-electron-window' });

      const invalid = await postExpectedErrorTool('runtimeInputDispatch', { action: 'click', x: 1 }, 'candidate.runtimeInputDispatch.negative.v1');
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    });
  });
});
