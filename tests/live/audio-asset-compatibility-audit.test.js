'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: audioAssetCompatibilityAudit candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('audits one discovered AudioClip and reports a bounded missing reference without claiming decode', async (t) => {
    if (!health?.ok) {
      t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
      return;
    }
    const discovered = await getJson('/tools/assetQuery?ccType=cc.AudioClip&limit=1');
    assert.equal(discovered.status, 200, JSON.stringify(discovered.body));
    if (!discovered.body.assets?.length) {
      t.skip('Creator project has no imported AudioClip fixture');
      return;
    }
    const positive = await postTool('audioAssetCompatibilityAudit', {
      assets: [{ id: discovered.body.assets[0].uuid, type: 'cc.AudioClip' }],
      target: 'web-mobile',
    });
    assert.equal(positive.status, 200, JSON.stringify(positive.body));
    assert.equal(positive.body.target, 'web-mobile');
    assert.equal(positive.body.items.length, 1);
    assert.equal(typeof positive.body.valid, 'boolean');
    assert.equal(typeof positive.body.complete, 'boolean');
    assert.ok(Array.isArray(positive.body.issues));
    assert.equal(Object.prototype.hasOwnProperty.call(positive.body, 'duration'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(positive.body, 'decoded'), false);

    const negative = await postTool('audioAssetCompatibilityAudit', {
      assets: [{ id: '__missing_audio_compatibility_candidate__', type: 'cc.AudioClip' }],
      target: 'native-desktop',
    });
    assert.equal(negative.status, 200, JSON.stringify(negative.body));
    assert.equal(negative.body.valid, false);
    assert.equal(negative.body.complete, true);
    assert.equal(negative.body.issues[0].code, 'ASSET_NOT_FOUND');

    const invalid = await postTool('audioAssetCompatibilityAudit', {
      assets: [{ id: discovered.body.assets[0].uuid, type: 'cc.Texture2D' }],
      target: 'web-mobile',
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.ok(invalid.body.validationErrors.some((error) => error.path === 'assets[0].type' && error.keyword === 'const'));
  });
});
