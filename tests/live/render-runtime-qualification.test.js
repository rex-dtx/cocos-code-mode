'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: render and runtime candidate witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  it('inspects a real material render pipeline and rejects missing material', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const material = await getJson('/tools/renderPipelineInspect?reference%5Bid%5D=1263d74c-8167-4928-91a6-4e2672411f47%408d883');
    assert.equal(material.status, 200, JSON.stringify(material.body));
    assert.equal(material.body.reference.id, '1263d74c-8167-4928-91a6-4e2672411f47@8d883');
    assert.ok(material.body.result);
    const missing = await getJson('/tools/renderPipelineInspect?reference%5Bid%5D=__missing_material__');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.result, undefined);
  });
  it('lists runtime sessions and fails closed for unverified preview transport', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const listed = await postTool('runtimeSessionLifecycle', { operation: 'list' });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.success, true);
    assert.equal(listed.body.operation, 'list');
    const missing = await postTool('runtimeSessionLifecycle', { operation: 'inspect', sessionId: '__missing_session__' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'SESSION_NOT_FOUND');
    const unavailable = await postTool('runtimeSessionLifecycle', { operation: 'attach', targetKind: 'game-view', targetId: '__missing_preview__' });
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.body.code, 'RUNTIME_NOT_READY');
  });
});
