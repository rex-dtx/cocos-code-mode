'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: UI form validation candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  it('creates a bounded form with explicit validation metadata', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const result = await postTool('uiFormValidationBind', { label: 'Email', placeholder: 'name@example.com', required: true, minLength: 5, name: `CandidateForm-${process.pid}` });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.rules.required, true);
    assert.equal(result.body.rules.minLength, 5);
    assert.equal(result.body.focusOrder.length, 2);
    assert.equal(result.body.rules.inputReference.id, result.body.form.input.id);
  });
  it('rejects bypassable validation rules before scene mutation', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const result = await postTool('uiFormValidationBind', { label: 'Invalid', required: false, minLength: 3 });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });
});
