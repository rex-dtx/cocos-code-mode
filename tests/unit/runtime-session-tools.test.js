'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { RuntimeSessionTools } = requireDist('utcp/tools/runtime-session-tools.js');

afterEach(() => { delete global.Editor; });

function installState(state) {
  global.Editor = { Message: { request: async (service, message) => {
    assert.equal(service, 'scene');
    assert.equal(message, 'execute-scene-script');
    return state;
  } } };
}

describe('verified game-view runtime sessions', () => {
  it('attaches only after runtime state read-back and exposes observe, wait, scenario and preview inspection', async () => {
    installState({ running: true, paused: false, timeScale: 1, frameCount: 12 });
    const tools = new RuntimeSessionTools();

    const attached = await tools.runtimeSessionLifecycle({ operation: 'attach', targetKind: 'game-view', targetId: 'game-view-main' });
    assert.equal(attached.success, true);
    assert.equal(attached.ready, true);
    assert.equal(attached.session.targetKind, 'game-view');
    assert.equal(attached.state.frameCount, 12);
    const sessionId = attached.session.sessionId;

    const observed = await tools.runtimeStateObserve({ sessionId });
    assert.equal(observed.state.paused, false);

    const waited = await tools.runtimeWaitForState({ sessionId, paused: false, minFrameCount: 10, timeoutMs: 100 });
    assert.equal(waited.success, true);

    const asserted = await tools.runtimeScenarioAssert({ sessionId, paused: false, minFrameCount: 10 });
    assert.equal(asserted.passed, true);

    const scenario = await tools.runtimeScenarioRun({ sessionId, steps: [
      { operation: 'assert', paused: false },
      { operation: 'wait', minFrameCount: 10, timeoutMs: 100 },
    ] });
    assert.equal(scenario.outcomes.length, 2);

    global.Editor.Message.request = async (service, message) => {
      if (service === 'preview' && message === 'query-preview-url') return 'http://127.0.0.1:7456';
      return { running: true, paused: false, timeScale: 1, frameCount: 13 };
    };
    const preview = await tools.previewSessionInspect({ sessionId });
    assert.equal(preview.ready, true);
    assert.equal(preview.stale, false);
    assert.match(preview.url, /^http:\/\/127\.0\.0\.1:/);
  });

  it('fails closed for malformed runtime state and marks stopped sessions explicitly', async () => {
    installState({ paused: false, timeScale: 1 });
    const tools = new RuntimeSessionTools();
    await assert.rejects(
      tools.runtimeSessionLifecycle({ operation: 'attach', targetKind: 'game-view', targetId: 'missing' }),
      (error) => error.code === 'RUNTIME_NOT_READY' && error.status === 409,
    );

    installState({ paused: false, timeScale: 1, frameCount: 1 });
    const attached = await tools.runtimeSessionLifecycle({ operation: 'attach', targetKind: 'game-view', targetId: 'stoppable' });
    const sessionId = attached.session.sessionId;
    await assert.rejects(
      tools.runtimeSessionLifecycle({ operation: 'stop', sessionId }),
      (error) => error.code === 'RUNTIME_CONTROL_UNAVAILABLE' && error.status === 409,
    );
    const inspected = await tools.runtimeSessionLifecycle({ operation: 'inspect', sessionId });
    assert.equal(inspected.ready, false);
    assert.equal(inspected.session.status, 'stopped');
    const preview = await tools.previewSessionInspect({ sessionId });
    assert.equal(preview.ready, false);
    assert.equal(preview.stale, true);
  });

  it('maps missing observed sessions to typed 404 errors', async () => {
    const tools = new RuntimeSessionTools();
    await assert.rejects(
      tools.runtimeStateObserve({ sessionId: '__missing_session__' }),
      (error) => error.code === 'SESSION_NOT_FOUND' && error.status === 404,
    );
  });
});
