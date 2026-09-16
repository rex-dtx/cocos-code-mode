'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: editor handshake and identity consistency', () => {
  let health;
  let expectedProjectPath;
  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const state = await getJson('/tools/editorState?timeoutMs=1000');
    assert.equal(state.status, 200, JSON.stringify(state.body));
    expectedProjectPath = state.body.projectPath;
  });

  it('binds bridge instance, project, build and scene readiness without mutation', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    let stableInstanceId;
    await repeatTestcase('EDITOR-HANDSHAKE-01', async () => {
      const handshake = await getJson(`/tools/editorHandshake?timeoutMs=1000&expectedProjectPath=${encodeURIComponent(expectedProjectPath)}`);
      assert.equal(handshake.status, 200, JSON.stringify(handshake.body));
      assert.equal(handshake.body.projectMatches, true);
      assert.equal(handshake.body.projectPath.replace(/\\/g, '/').toLowerCase(), expectedProjectPath.replace(/\\/g, '/').toLowerCase());
      assert.equal(handshake.body.editorVersion, '3.7.3');
      assert.match(handshake.body.instanceId, /^[a-f0-9]{32}$/);
      assert.equal(handshake.body.probe.status, 'responsive');
      assert.equal(typeof handshake.body.probe.sceneReady, 'boolean');
      assert.equal(handshake.body.probe.code, null);
      assert.equal(handshake.body.build.branch, 'feat/ccb3x-api-capability-expansion');
      assert.match(handshake.body.build.commit, /^[a-f0-9]{7,}$/);
      assert.ok(handshake.body.elapsedMs >= 0);
      if (stableInstanceId === undefined) stableInstanceId = handshake.body.instanceId;
      else assert.equal(handshake.body.instanceId, stableInstanceId);

      const wrong = await getJson(`/tools/editorHandshake?timeoutMs=1000&expectedProjectPath=${encodeURIComponent(`${expectedProjectPath}/__wrong__`)}`);
      assert.equal(wrong.status, 200, JSON.stringify(wrong.body));
      assert.equal(wrong.body.projectMatches, false);
      assert.equal(wrong.body.instanceId, stableInstanceId);

      const invalid = await getJson('/tools/editorHandshake?expectedProjectPath=relative');
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    });
  });
});
