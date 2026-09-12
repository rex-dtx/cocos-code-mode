'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, getExpectedErrorJson, healthCheck } = require('../helpers/utcp-client');

describe('live: read-only candidate qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('audits prefab references and computes a bounded override diff', async (t) => {
    if (skipIfDown(t)) return;
    const marker = 'f8befe54-5f06-4454-b61b-eb99915fc8f8';
    const dialog = '9c561266-65f5-4f20-9947-ecd2353c2111';
    const audit = await getJson(`/tools/prefabReferenceAudit?reference%5Bid%5D=${marker}`);
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.equal(audit.body.valid, true);
    assert.deepEqual(audit.body.missingReferences, []);
    const diff = await getJson(`/tools/prefabOverrideDiff?reference%5Bid%5D=${marker}&baselineReference%5Bid%5D=${dialog}`);
    assert.equal(diff.status, 200, JSON.stringify(diff.body));
    assert.equal(diff.body.equal, false);
    assert.ok(diff.body.changes.length > 0);
    const missing = await getExpectedErrorJson('/tools/prefabReferenceAudit?reference%5Bid%5D=__missing_prefab__', 'candidate.prefabReferenceAudit.negative.v1');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
  });

  it('audits active UI labels and computes deterministic focus links', async (t) => {
    if (skipIfDown(t)) return;
    const accessibility = await getJson('/tools/uiAccessibilityAudit?rootPath=Canvas&maxNodes=128');
    assert.equal(accessibility.status, 200, JSON.stringify(accessibility.body));
    assert.equal(accessibility.body.complete, false);
    assert.ok(Array.isArray(accessibility.body.nodes));
    const focus = await getJson('/tools/uiFocusNavigation?axis=horizontal&references%5B0%5D%5Bid%5D=edz7B9j%2FhPuKyoyNr7Ob3A&references%5B1%5D%5Bid%5D=9cCGnolNtAlL%2F3pOZ5THs2');
    assert.equal(focus.status, 200, JSON.stringify(focus.body));
    assert.equal(focus.body.links.length, 2);
    const missing = await getExpectedErrorJson('/tools/uiAccessibilityAudit?root%5Bid%5D=__missing_ui_root__', 'candidate.uiAccessibilityAudit.negative.v1');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.error.code, 'UI_ACCESSIBILITY_ROOT_NOT_FOUND');
    const invalidFocus = await getExpectedErrorJson('/tools/uiFocusNavigation?axis=horizontal&references%5B0%5D%5Bid%5D=__missing_ui_node__', 'candidate.uiFocusNavigation.negative.v1');
    assert.equal(invalidFocus.status, 404);
  });
});
