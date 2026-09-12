'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: audioSourceConfigure candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('configures bounded AudioSource state, reads it back, and leaves playback untouched', async (t) => {
    if (skipIfDown(t)) return;
    const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const sc=cc.director.getScene();const old=sc.getChildByName('__audio_configure_candidate__');if(old){old.removeFromParent();old.destroy();}const n=new cc.Node('__audio_configure_candidate__');sc.addChild(n);const A=cc.js.getClassByName('cc.AudioSource');if(!A){n.removeFromParent();n.destroy();return {unsupported:true};}const a=n.addComponent(A);return {id:n.uuid,component:a.uuid||null,unsupported:false};`,
    });
    assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
    if (fixture.body.result.unsupported) {
      t.skip('cc.AudioSource is unavailable in this Creator runtime');
      return;
    }
    const id = fixture.body.result.id;
    try {
      const configured = await postTool('audioSourceConfigure', {
        reference: { id, type: 'cc.Node' },
        properties: {
          volume: 0.6,
          loop: true,
          playOnAwake: false,
          clip: { id: 'a0e999f9-01fa-45df-a8e5-6f996e15735a', type: 'cc.AudioClip' },
        },
      });
      assert.equal(configured.status, 200, JSON.stringify(configured.body));
      assert.equal(configured.body.verified, true);
      assert.equal(configured.body.properties.volume, 0.6);
      assert.equal(configured.body.properties.loop, true);
      assert.equal(configured.body.properties.playOnAwake, false);
      assert.deepEqual(configured.body.properties.clip, { id: 'a0e999f9-01fa-45df-a8e5-6f996e15735a', type: 'cc.AudioClip' });
      assert.deepEqual(configured.body.changed, ['volume', 'loop', 'playOnAwake', 'clip']);

      const inspected = await getJson(`/tools/audioSourceInspect?reference%5Bid%5D=${encodeURIComponent(id)}`);
      assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
      assert.equal(inspected.body.sources[0].properties.volume.value, 0.6);
      assert.equal(inspected.body.sources[0].properties.loop.value, true);
      assert.equal(inspected.body.sources[0].properties.playOnAwake.value, false);

      const invalid = await postTool('audioSourceConfigure', {
        reference: { id, type: 'cc.Node' },
        properties: { volume: 1.5 },
      });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      assert.ok(invalid.body.validationErrors.some((error) => error.path === 'properties.volume' && error.keyword === 'maximum'));

      const missing = await postTool('audioSourceConfigure', {
        reference: { id: '__missing_audio_configure_candidate__', type: 'cc.Node' },
        properties: { loop: false },
      });
      assert.equal(missing.status, 404, JSON.stringify(missing.body));
      assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
    } finally {
      const cleanup = await postTool('executeJavascript', {
        context: 'scene',
        code: `const n=cc.director.getScene().getChildByName('__audio_configure_candidate__');if(n){n.removeFromParent();n.destroy();}return true;`,
      });
      assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
    }
  });
});
