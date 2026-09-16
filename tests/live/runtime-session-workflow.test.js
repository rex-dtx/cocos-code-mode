'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  postTool,
  postExpectedErrorTool,
  repeatTestcase,
  healthCheck,
} = require('../helpers/utcp-client');

describe('live: verified game-view runtime session workflows', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('attaches, observes, waits, asserts, inspects preview, and stops a verified session', { timeout: 180_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('RUNTIME-SESSION-01', async ({ iteration }) => {
      const state = await postTool('runtimePreviewControl', { operation: 'state' });
      assert.equal(state.status, 200, JSON.stringify(state.body));
      const expectedPaused = state.body.state.paused;

      let sessionId;
      try {
        const attached = await postTool('runtimeSessionLifecycle', {
          operation: 'attach',
          targetKind: 'game-view',
          targetId: `qualification-${process.pid}-${iteration}`,
        });
        assert.equal(attached.status, 200, JSON.stringify(attached.body));
        assert.equal(attached.body.success, true);
        assert.equal(attached.body.ready, true);
        assert.equal(attached.body.session.targetKind, 'game-view');
        assert.equal(attached.body.state.running, true);
        sessionId = attached.body.session.sessionId;

        const observed = await postTool('runtimeStateObserve', { sessionId });
        assert.equal(observed.status, 200, JSON.stringify(observed.body));
        assert.equal(observed.body.state.running, true);

        const waited = await postTool('runtimeWaitForState', {
          sessionId,
          paused: expectedPaused,
          minFrameCount: observed.body.state.frameCount,
          timeoutMs: 1000,
        });
        assert.equal(waited.status, 200, JSON.stringify(waited.body));
        assert.equal(waited.body.success, true);

        const asserted = await postTool('runtimeScenarioAssert', {
          sessionId,
          paused: expectedPaused,
          minFrameCount: observed.body.state.frameCount,
        });
        assert.equal(asserted.status, 200, JSON.stringify(asserted.body));
        assert.equal(asserted.body.passed, true);

        const scenario = await postTool('runtimeScenarioRun', {
          sessionId,
          steps: [
            { operation: 'assert', paused: expectedPaused },
            { operation: 'wait', minFrameCount: observed.body.state.frameCount, timeoutMs: 1000 },
          ],
        });
        assert.equal(scenario.status, 200, JSON.stringify(scenario.body));
        assert.equal(scenario.body.success, true);
        assert.equal(scenario.body.outcomes.length, 2);

        const preview = await postTool('previewSessionInspect', { sessionId });
        assert.equal(preview.status, 200, JSON.stringify(preview.body));
        assert.equal(preview.body.ready, true);
        assert.equal(preview.body.stale, false);
        assert.match(preview.body.url, /^https?:\/\//);

        const invalidWait = await postExpectedErrorTool('runtimeWaitForState', { sessionId }, 'candidate.runtimeWaitForState.negative.v1');
        assert.equal(invalidWait.status, 400, JSON.stringify(invalidWait.body));
        assert.equal(invalidWait.body.code, 'INVALID_ARGUMENT');
      } finally {
        if (sessionId) {
          const stoppedSession = await postExpectedErrorTool('runtimeSessionLifecycle', {
            operation: 'stop',
            sessionId,
          }, 'candidate.previewSessionInspect.negative.v1');
          assert.equal(stoppedSession.status, 409, JSON.stringify(stoppedSession.body));
          assert.equal(stoppedSession.body.code, 'RUNTIME_CONTROL_UNAVAILABLE');
          const stale = await postTool('previewSessionInspect', { sessionId });
          assert.equal(stale.status, 200, JSON.stringify(stale.body));
          assert.equal(stale.body.ready, false);
          assert.equal(stale.body.stale, true);
        }
        // The preview already existed before this scenario. Leave it running;
        // only the bounded local runtime session is stopped above.
      }
    });
  });
});
