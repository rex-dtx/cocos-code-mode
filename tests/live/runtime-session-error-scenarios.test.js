'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, postExpectedErrorTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: runtime session error and lifecycle scenarios', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('covers unsupported transport, missing session, false assertions, timeout, stop and reset', { timeout: 180_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('RUNTIME-SESSION-E01', async ({ iteration }) => {
      const unsupported = await postExpectedErrorTool('runtimeSessionLifecycle', {
        operation: 'attach', targetKind: 'browser-preview', targetId: `browser-${iteration}`,
      }, 'runtime.session.unsupported.v1');
      assert.equal(unsupported.status, 422, JSON.stringify(unsupported.body));
      assert.equal(unsupported.body.code, 'UNSUPPORTED_RUNTIME_TRANSPORT');

      const missing = await postExpectedErrorTool('runtimeStateObserve', { sessionId: '__missing_session__' }, 'runtime.session.missing.v1');
      assert.equal(missing.status, 404, JSON.stringify(missing.body));
      assert.equal(missing.body.code, 'SESSION_NOT_FOUND');

      const current = await postTool('runtimePreviewControl', { operation: 'state' });
      assert.equal(current.status, 200, JSON.stringify(current.body));
      const started = await postTool('runtimeSessionLifecycle', { operation: 'start', targetKind: 'game-view' });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      let sessionId = started.body.session.sessionId;
      try {
        const attached = await postTool('runtimeSessionLifecycle', {
          operation: 'attach', targetKind: 'game-view', targetId: started.body.session.targetId,
        });
        assert.equal(attached.status, 200, JSON.stringify(attached.body));
        sessionId = attached.body.session.sessionId;
        const observed = attached.body.state;

        const falseAssertion = await postTool('runtimeScenarioAssert', {
          sessionId,
          paused: !observed.paused,
        });
        assert.equal(falseAssertion.status, 200, JSON.stringify(falseAssertion.body));
        assert.equal(falseAssertion.body.passed, false);
        assert.ok(falseAssertion.body.issues.length > 0);

        const timeout = await postExpectedErrorTool('runtimeWaitForState', {
          sessionId,
          paused: !observed.paused,
          timeoutMs: 100,
        }, 'runtime.session.timeout.v1');
        assert.equal(timeout.status, 409, JSON.stringify(timeout.body));
        assert.equal(timeout.body.code, 'RUNTIME_STATE_TIMEOUT');

        const stopped = await postTool('runtimeSessionLifecycle', { operation: 'stop', sessionId });
        assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
        assert.equal(stopped.body.session.status, 'stopped');

        const observedStopped = await postExpectedErrorTool('runtimeStateObserve', { sessionId }, 'runtime.session.stopped.v1');
        assert.equal(observedStopped.status, 409, JSON.stringify(observedStopped.body));
        assert.equal(observedStopped.body.code, 'RUNTIME_SESSION_STOPPED');

        const reset = await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId });
        assert.equal(reset.status, 200, JSON.stringify(reset.body));
        assert.equal(reset.body.session.reset, true);
        sessionId = null;

        const afterReset = await postExpectedErrorTool('previewSessionInspect', { sessionId: attached.body.session.sessionId }, 'runtime.session.after-reset.v1');
        assert.equal(afterReset.status, 404, JSON.stringify(afterReset.body));
        assert.equal(afterReset.body.code, 'SESSION_NOT_FOUND');
      } finally {
        if (sessionId) {
          await postTool('runtimeSessionLifecycle', { operation: 'stop', sessionId });
          await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId });
        }
        if (current.body.ready) {
          const restored = await postTool('runtimePreviewControl', { operation: 'start' });
          if (current.body.preview.state === 'pause') await postTool('runtimePreviewControl', { operation: 'pause' });
          if (restored.body.session) await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId: restored.body.session.sessionId });
        }
      }
    });
  });
});
