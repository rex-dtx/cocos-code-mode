'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { InputTools } = requireDist('utcp/tools/input-tools.js');

describe('runtimeInputDispatch', () => {
  it('routes bounded key and click actions through existing input primitives', async () => {
    const tools = new InputTools();
    const calls = [];
    tools.simulateKeyPress = async (args) => { calls.push(['key', args]); return { success: true, key: args.key }; };
    tools.simulateMouseClick = async (args) => { calls.push(['click', args]); return { success: true }; };

    assert.deepEqual(await tools.runtimeInputDispatch({ action: 'key', key: 'Escape', modifiers: { ctrl: true } }), { success: true, action: 'key', target: 'active-electron-window' });
    assert.deepEqual(await tools.runtimeInputDispatch({ action: 'click', x: 10, y: 20, button: 'left' }), { success: true, action: 'click', target: 'active-electron-window' });
    assert.deepEqual(calls, [
      ['key', { key: 'Escape', modifiers: { ctrl: true } }],
      ['click', { x: 10, y: 20, button: 'left' }],
    ]);
  });

  it('rejects incomplete actions before dispatch', async () => {
    const tools = new InputTools();
    await assert.rejects(tools.runtimeInputDispatch({ action: 'key' }), (error) => error.code === 'INVALID_ARGUMENT');
    await assert.rejects(tools.runtimeInputDispatch({ action: 'click', x: 1 }), (error) => error.code === 'INVALID_ARGUMENT');
  });
});
