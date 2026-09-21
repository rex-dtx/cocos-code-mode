'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, postExpectedErrorTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: particle playback error scenarios', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('rejects missing nodes, non-particle nodes, missing sessions and stopped sessions', { timeout: 180_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('PARTICLE-PLAYBACK-E01', async ({ iteration }) => {
      const name = `__ccp3x_particle_error_${process.pid}_${iteration}__`;
      const before = await postTool('runtimePreviewControl', { operation: 'state' });
      assert.equal(before.status, 200, JSON.stringify(before.body));
      const started = await postTool('runtimeSessionLifecycle', { operation: 'start', targetKind: 'game-view' });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const node = await postTool('executeJavascript', {
        context: 'scene',
        code: `const scene=cc.director.getScene();const old=scene.getChildByName(${JSON.stringify(name)});if(old){old.removeFromParent();old.destroy();}const n=new cc.Node(${JSON.stringify(name)});scene.addChild(n);return {id:n.uuid};`,
      });
      assert.equal(node.status, 200, JSON.stringify(node.body));
      const nodeReference = { id: node.body.result.id };
      let sessionId = started.body.session.sessionId;
      try {
        const noSession = await postExpectedErrorTool('particlePlayback', {
          sessionId: '__missing_session__', operation: 'play', nodeReference,
        }, 'particle.playback.missing-session.v1');
        assert.equal(noSession.status, 404, JSON.stringify(noSession.body));
        assert.equal(noSession.body.code, 'SESSION_NOT_FOUND');

        const attached = await postTool('runtimeSessionLifecycle', {
          operation: 'attach', targetKind: 'game-view', targetId: started.body.session.targetId,
        });
        assert.equal(attached.status, 200, JSON.stringify(attached.body));
        sessionId = attached.body.session.sessionId;

        const nonParticle = await postExpectedErrorTool('particlePlayback', {
          sessionId, operation: 'play', nodeReference,
        }, 'particle.playback.non-particle.v1');
        assert.equal(nonParticle.status, 502, JSON.stringify(nonParticle.body));
        assert.equal(nonParticle.body.code, 'PARTICLE_PLAYBACK_FAILED');

        const missingNode = await postExpectedErrorTool('particlePlayback', {
          sessionId, operation: 'play', nodeReference: { id: '__missing_particle_node__' },
        }, 'particle.playback.missing-node.v1');
        assert.equal(missingNode.status, 502, JSON.stringify(missingNode.body));
        assert.equal(missingNode.body.code, 'PARTICLE_PLAYBACK_FAILED');

        const stopped = await postTool('runtimeSessionLifecycle', { operation: 'stop', sessionId });
        assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
        const stoppedSession = await postExpectedErrorTool('particlePlayback', {
          sessionId, operation: 'play', nodeReference,
        }, 'particle.playback.stopped.v1');
        assert.equal(stoppedSession.status, 409, JSON.stringify(stoppedSession.body));
        assert.equal(stoppedSession.body.code, 'RUNTIME_SESSION_STOPPED');
        await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId });
        sessionId = null;
      } finally {
        if (sessionId) {
          await postTool('runtimeSessionLifecycle', { operation: 'stop', sessionId });
          await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId });
        }
        const removed = await postTool('executeJavascript', {
          context: 'scene',
          code: `const n=cc.director.getScene().getChildByName(${JSON.stringify(name)});if(n){n.removeFromParent();n.destroy();}return true;`,
        });
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        if (before.body.ready) {
          const restored = await postTool('runtimePreviewControl', { operation: 'start' });
          if (before.body.preview.state === 'pause') await postTool('runtimePreviewControl', { operation: 'pause' });
          if (restored.body.session) await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId: restored.body.session.sessionId });
        }
      }
    });
  });
});
