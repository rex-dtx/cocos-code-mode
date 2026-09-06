'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { validateSchemaArguments, findMissingRequiredInputs } = requireDist('utcp/schema-validate.js');

const schema = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: ['tree', 'dump'] },
    uuid: { type: 'string' },
  },
  required: ['operation'],
};

describe('schema-validate', () => {
  it('accepts a valid operation', () => {
    assert.deepEqual(validateSchemaArguments(schema, { operation: 'tree' }), []);
  });

  it('rejects missing required fields', () => {
    const errors = validateSchemaArguments(schema, {});
    assert.equal(errors.length, 1);
    assert.equal(errors[0].keyword, 'required');
    assert.equal(errors[0].path, 'operation');
    assert.deepEqual(findMissingRequiredInputs(schema, {}), ['operation']);
  });

  it('treats empty string as missing', () => {
    assert.deepEqual(findMissingRequiredInputs(schema, { operation: '' }), ['operation']);
  });

  it('rejects enum mismatch', () => {
    const errors = validateSchemaArguments(schema, { operation: 'explode' });
    assert.equal(errors[0].keyword, 'enum');
    assert.equal(errors[0].path, 'operation');
  });
});
