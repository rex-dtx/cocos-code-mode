'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { healthCheck, repeatTestcase } = require('../helpers/utcp-client');
const { ensureQualificationScene } = require('../helpers/qualification-scene');

describe('live: dedicated qualification scene readiness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('opens and verifies stable entity and component fixtures', async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('QUAL-SCENE-01', async () => {
      const result = await ensureQualificationScene();
      assert.equal(result.info.currentScene.uuid, result.manifest.scene.uuid);
      assert.equal(result.info.dirty, false);
    });
  });
});
