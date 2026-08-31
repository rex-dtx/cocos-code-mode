'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

describe('required tool input validation', () => {
  it('rejects only omitted top-level required inputs', () => {
    const { findMissingRequiredInputs } = requireDist('utcp/utcp-server.js');
    const schema = { type: 'object', required: ['operation', 'enabled'] };

    assert.deepEqual(findMissingRequiredInputs(schema, {}), ['operation', 'enabled']);
    assert.deepEqual(findMissingRequiredInputs(schema, { operation: 'query', enabled: false }), []);
  });
});
