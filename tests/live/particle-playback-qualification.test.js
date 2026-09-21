'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, postExpectedErrorTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: particle playback qualification', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('controls a real runtime particle component through a verified session', { timeout: 180_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('PARTICLE-PLAYBACK-01', async ({ iteration }) => {
      const name = `__ccp3x_particle_playback_${process.pid}_${iteration}__`;
      const before = await postTool('runtimePreviewControl', { operation: 'state' });
      assert.equal(before.status, 200, JSON.stringify(before.body));
      const started = await postTool('runtimeSessionLifecycle', { operation: 'start', targetKind: 'game-view' });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      const fixture = await postTool('executeJavascript', {
        context: 'scene',
        code: `const scene=cc.director.getScene();const old=scene.getChildByName(${JSON.stringify(name)});if(old){old.removeFromParent();old.destroy();}const C=cc.ParticleSystem||cc.js.getClassByName('cc.ParticleSystem');if(!C)return {skip:true};const n=new cc.Node(${JSON.stringify(name)});scene.addChild(n);const p=n.addComponent(C);return {id:n.uuid,component:p.uuid};`,
      });
      assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
      if (fixture.body.result.skip) {
        await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId: started.body.session.sessionId });
        if (!before.body.ready) await postTool('runtimePreviewControl', { operation: 'stop' });
        return { status: 'SKIP', reason: 'cc.ParticleSystem unavailable' };
      }
      const nodeReference = { id: fixture.body.result.id };
      let sessionId = started.body.session.sessionId;
      try {
        const attached = await postTool('runtimeSessionLifecycle', {
          operation: 'attach',
          targetKind: 'game-view',
          targetId: started.body.session.targetId,
        });
        assert.equal(attached.status, 200, JSON.stringify(attached.body));
        sessionId = attached.body.session.sessionId;

        for (const operation of ['play', 'stop', 'clear']) {
          const result = await postTool('particlePlayback', { sessionId, operation, nodeReference });
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(result.body.success, true);
          assert.equal(result.body.operation, operation);
          assert.equal(result.body.nodeReference.id, nodeReference.id);
          assert.equal(typeof result.body.state.playing, 'boolean');
        }

        const invalid = await postExpectedErrorTool('particlePlayback', {
          sessionId,
          operation: 'seek',
          nodeReference,
        }, 'candidate.particlePlayback.negative.v1');
        assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      } finally {
        if (sessionId) {
          const released = await postTool('runtimeSessionLifecycle', { operation: 'reset', sessionId });
          assert.equal(released.status, 200, JSON.stringify(released.body));
        }
        const removed = await postTool('executeJavascript', {
          context: 'scene',
          code: `const n=cc.director.getScene().getChildByName(${JSON.stringify(name)});if(n){n.removeFromParent();n.destroy();}return true;`,
        });
        assert.equal(removed.status, 200, JSON.stringify(removed.body));
        if (!before.body.ready) {
          const stopped = await postTool('runtimePreviewControl', { operation: 'stop' });
          assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
        }
      }
    });
  });
});
