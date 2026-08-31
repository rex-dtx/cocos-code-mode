'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { validateSchemaArguments } = requireDist('utcp/utcp-server.js');

describe('schema input validation', () => {
  it('reports nested required field paths without rejecting false, zero, or null values', () => {
    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            retries: { type: 'integer', minimum: 0 },
            value: { type: 'null' },
            name: { type: 'string' },
          },
          required: ['enabled', 'retries', 'value', 'name'],
        },
      },
      required: ['config'],
    };

    assert.deepEqual(validateSchemaArguments(schema, {
      config: { enabled: false, retries: 0, value: null },
    }), [{ path: 'config.name', keyword: 'required', message: 'Required property is missing.' }]);

    assert.deepEqual(validateSchemaArguments(schema, {
      config: { enabled: false, retries: 0, value: null, name: '' },
    }), []);
  });

  it('selects conditional branches and requires an alternative variant', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: { enum: ['text', 'count'] },
        value: {
          oneOf: [{ type: 'string' }, { type: 'integer' }],
        },
      },
      required: ['mode', 'value'],
      if: {
        type: 'object',
        properties: { mode: { const: 'text' } },
        required: ['mode'],
      },
      then: {
        type: 'object',
        properties: { value: { type: 'string', minLength: 1 } },
      },
      else: {
        type: 'object',
        properties: { value: { type: 'integer', minimum: 0 } },
      },
    };

    assert.deepEqual(validateSchemaArguments(schema, { mode: 'text', value: 0 }), [{
      path: 'value', keyword: 'type', message: 'Expected string.',
    }]);
    assert.deepEqual(validateSchemaArguments(schema, { mode: 'count', value: false }), [
      { path: 'value', keyword: 'oneOf', message: 'Value must match exactly one schema.' },
      { path: 'value', keyword: 'type', message: 'Expected integer.' },
    ]);
    assert.deepEqual(validateSchemaArguments(schema, { mode: 'text', value: 'ok' }), []);
    assert.deepEqual(validateSchemaArguments(schema, { mode: 'count', value: 0 }), []);
  });

  it('enforces types, numeric ranges, and array item caps with field paths', () => {
    const schema = {
      type: 'object',
      properties: {
        ratio: { type: 'number', minimum: 0, maximum: 1 },
        ids: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: { type: 'integer', minimum: 1 },
        },
      },
      required: ['ratio', 'ids'],
    };

    assert.deepEqual(validateSchemaArguments(schema, { ratio: 2, ids: [1, 0, 3] }), [
      { path: 'ratio', keyword: 'maximum', message: 'Must be at most 1.' },
      { path: 'ids', keyword: 'maxItems', message: 'Must contain at most 2 items.' },
      { path: 'ids[1]', keyword: 'minimum', message: 'Must be at least 1.' },
    ]);
  });

  it('accepts anyOf variants when exactly one variant is not required', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
        { type: 'object', properties: { limit: { type: 'integer', minimum: 0 } }, required: ['limit'] },
      ],
    };

    assert.deepEqual(validateSchemaArguments(schema, { enabled: false }), []);
    assert.deepEqual(validateSchemaArguments(schema, { limit: 0 }), []);
    assert.deepEqual(validateSchemaArguments(schema, {}), [{
      path: '$', keyword: 'anyOf', message: 'Value must match at least one schema.'
    }]);
  });

  it('enforces allOf conditional branches', () => {
    const schema = {
      type: 'object',
      properties: { operation: { type: 'string' }, reference: { type: 'object' } },
      required: ['operation'],
      allOf: [{
        if: { properties: { operation: { const: 'read' } }, required: ['operation'] },
        then: { required: ['reference'] },
      }],
    };

    assert.deepEqual(validateSchemaArguments(schema, { operation: 'read' }), [{
      path: 'reference', keyword: 'required', message: 'Required property is missing.',
    }]);
    assert.deepEqual(validateSchemaArguments(schema, { operation: 'write' }), []);
  });
});
