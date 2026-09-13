'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { methods } = requireDist('scene.js');

function withScene(root, run) {
  const previous = global.cc;
  global.cc = { director: { getScene: () => root } };
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete global.cc;
    else global.cc = previous;
  });
}

class Animation {
  constructor() {
    this.clips = [{ uuid: 'clip-idle', name: 'idle', duration: 2, sample: 30 }];
    this.defaultClip = null;
    this.playOnLoad = false;
    this.state = { speed: 1, time: 0, repeatCount: 1, wrapMode: 0, isPlaying: false, isPaused: false };
  }
  getState(name) { return name === 'idle' ? this.state : null; }
  play(name) { this.played = name || 'default'; this.state.isPlaying = true; }
  crossFade(name, duration) { this.faded = { name, duration }; }
  pause() { this.state.isPaused = true; }
  resume() { this.state.isPaused = false; }
  stop() { this.state.isPlaying = false; }
}

class Skeleton {
  static AnimationCacheMode = { REALTIME: 0, SHARED_CACHE: 1, PRIVATE_CACHE: 2 };
  constructor() { this._cacheMode = 0; this.paused = false; }
  isAnimationCached() { return this._cacheMode !== 0; }
  setAnimationCacheMode(mode) { this._cacheMode = mode; }
  invalidAnimationCache() { this.invalidated = true; }
  setAnimation(track, name, loop) { this.played = { track, name, loop }; }
  clearTracks() { this.cleared = true; }
}

describe('animation scene runtime control', () => {
  it('analyzes clip setup and recommends a default clip', async () => {
    const animation = new Animation();
    const root = { uuid: 'root', name: 'Root', components: [animation], children: [] };
    await withScene(root, async () => {
      const report = await methods.animationUsageAnalyze({ maxNodes: 10 });
      assert.equal(report.componentCount, 1);
      assert.equal(report.findings[0].clipCount, 1);
      assert.match(report.findings[0].recommendations[0], /default clip/);
    });
  });

  it('controls generic animation state and returns read-back', async () => {
    const animation = new Animation();
    const root = { uuid: 'root', name: 'Root', components: [animation], children: [] };
    await withScene(root, async () => {
      await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'set_default', clipName: 'idle' });
      await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'set_state', clipName: 'idle', speed: 2, time: 0.5, repeatCount: 3 });
      await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'play', clipName: 'idle' });
      const inspected = await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'inspect' });
      assert.equal(animation.defaultClip.uuid, 'clip-idle');
      assert.equal(animation.state.speed, 2);
      assert.equal(animation.state.time, 0.5);
      assert.equal(animation.state.repeatCount, 3);
      assert.equal(animation.played, 'idle');
      assert.equal(inspected.animation.defaultClip, 'clip-idle');
      assert.equal(inspected.animation.states[0].speed, 2);
      assert.equal(inspected.animation.states[0].time, 0.5);
      assert.equal(inspected.animation.states[0].repeatCount, 3);
    });
  });

  it('sets, reads, and invalidates Spine cache mode', async () => {
    const skeleton = new Skeleton();
    const root = { uuid: 'root', name: 'Root', components: [skeleton], children: [] };
    await withScene(root, async () => {
      const configured = await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'set_cache_mode', cacheMode: 'SHARED_CACHE' });
      assert.equal(configured.spine.cacheMode, 1);
      assert.equal(configured.spine.cached, true);
      await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'invalidate_cache' });
      await methods.animationRuntimeControl({ nodeUuid: 'root', operation: 'play', clipName: 'run', loop: true });
      assert.equal(skeleton.invalidated, true);
      assert.deepEqual(skeleton.played, { track: 0, name: 'run', loop: true });
    });
  });
});
