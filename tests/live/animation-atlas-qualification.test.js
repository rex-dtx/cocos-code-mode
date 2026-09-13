'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, getExpectedErrorJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: animation and atlas candidate qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('inspects and validates a real skeletal node without claiming playback', async (t) => {
    if (skipIfDown(t)) return;
    const reference = { id: '01y4w70SBFcIJPZAIkePSX', type: 'cc.Node' };
    const inspect = await getJson(`/tools/skeletalAnimationInspect?nodeReference%5Bid%5D=${reference.id}&maxClips=10`);
    assert.equal(inspect.status, 200, JSON.stringify(inspect.body));
    assert.deepEqual(inspect.body.reference, reference);
    assert.ok(Array.isArray(inspect.body.clips));
    assert.equal(inspect.body.truncated, false);
    const validate = await postTool('skeletalAnimationValidate', { nodeReference: reference, maxClips: 10 });
    assert.equal(validate.status, 200, JSON.stringify(validate.body));
    assert.equal(validate.body.valid, true);
    assert.equal(validate.body.clipCount, inspect.body.totalClips);
    const invalid = await getExpectedErrorJson(`/tools/skeletalAnimationInspect?nodeReference%5Bid%5D=${reference.id}&maxClips=0`, 'candidate.skeletalAnimationInspect.negative.v1');
    assert.equal(invalid.status, 400);
  });

  it('round-trips bounded auto-atlas dimensions and rejects non-atlas assets', async (t) => {
    if (skipIfDown(t)) return;
    const atlas = { id: 'b32ea244-01d6-4c63-a9e8-736a784bf7dc', type: 'cc.SpriteAtlas' };
    const original = { maxWidth: 2048, maxHeight: 2048 };
    try {
      const changed = await postTool('spriteAtlasConfigure', { reference: atlas, presetId: 'default', maxWidth: 1024, maxHeight: 1024 });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.equal(changed.body.changed, true);
      assert.equal(changed.body.operations.length, 2);
      assert.deepEqual(changed.body.operations.map((operation) => operation.readBack), [1024, 1024]);
      const wrongType = await postTool('spriteAtlasConfigure', { reference: { id: 'f8befe54-5f06-4454-b61b-eb99915fc8f8', type: 'cc.Prefab' }, presetId: 'default' });
      assert.equal(wrongType.status, 422);
      assert.equal(wrongType.body.code, 'TYPE_MISMATCH');
    } finally {
      const restored = await postTool('spriteAtlasConfigure', { reference: atlas, presetId: 'default', ...original });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.deepEqual(restored.body.operations.map((operation) => operation.readBack), [2048, 2048]);
    }
  });
});
