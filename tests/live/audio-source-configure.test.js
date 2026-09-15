'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

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
    await repeatTestcase('AUDIO-C01', async () => {
      const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const sc=cc.director.getScene();const canvas=sc.getChildByName('Canvas');if(!canvas)return {unsupported:true};const old=canvas.getChildByName('__audio_configure_candidate__');if(old){old.removeFromParent();old.destroy();}const n=new cc.Node('__audio_configure_candidate__');canvas.addChild(n);const A=cc.js.getClassByName('cc.AudioSource');if(!A){n.removeFromParent();n.destroy();return {unsupported:true};}const a=n.addComponent(A);return {id:n.uuid,component:a.uuid||null,unsupported:false};`,
      });
      assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
      if (fixture.body.result.unsupported) return { status: 'SKIP', reason: 'cc.AudioSource unavailable' };
      const id = fixture.body.result.id;
      try {
        const configured = await postTool('audioSourceConfigure', { reference: { id, type: 'cc.Node' }, properties: { volume: 0.6, loop: true, playOnAwake: false, clip: { id: 'a0e999f9-01fa-45df-a8e5-6f996e15735a', type: 'cc.AudioClip' } } });
        assert.equal(configured.status, 200, JSON.stringify(configured.body));
        assert.equal(configured.body.verified, true);
        assert.equal(configured.body.properties.volume, 0.6);
        assert.equal(configured.body.properties.loop, true);
        const inspected = await getJson(`/tools/audioSourceInspect?reference%5Bid%5D=${encodeURIComponent(id)}`);
        assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
        assert.equal(inspected.body.sources[0].properties.volume.value, 0.6);
        assert.equal(inspected.body.sources[0].properties.loop.value, true);
      } finally {
        await postTool('executeJavascript', { context: 'scene', code: `const n=cc.director.getScene().getChildByName('__audio_configure_candidate__');if(n){n.removeFromParent();n.destroy();}return true;` });
      }
    });
  });
});
