'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

describe('live: UI form validation candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  it('creates a Canvas-hosted bounded form with explicit validation metadata', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    const name = `CandidateForm-${process.pid}`;
    let formReference;
    try {
      const result = await postTool('uiFormValidationBind', {
        label: 'Email',
        placeholder: 'name@example.com',
        required: true,
        minLength: 5,
        name,
        parentReference: canvas,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      formReference = result.body.form.reference;
      assert.equal(result.body.rules.required, true);
      assert.equal(result.body.rules.minLength, 5);
      assert.equal(result.body.focusOrder.length, 2);
      assert.equal(result.body.rules.inputReference.id, result.body.form.input.id);

      const found = await getJson(`/tools/findNodes?name=${encodeURIComponent(name)}&maxResults=1`);
      assert.equal(found.ok, true, JSON.stringify(found.body));
      assert.equal(found.body.nodes[0].reference.id, formReference.id);
      assert.match(found.body.nodes[0].path, /\/Canvas\/CandidateForm-/);
    } finally {
      if (formReference) {
        const deleted = await postTool('nodeOperate', { operation: 'delete', reference: formReference });
        assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
      }
    }
  });
  it('rejects bypassable validation rules before scene mutation', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const result = await postTool('uiFormValidationBind', { label: 'Invalid', required: false, minLength: 3 });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });
});
