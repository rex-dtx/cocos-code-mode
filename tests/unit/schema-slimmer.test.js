'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { slimOutputsSchema } = requireDist('utcp/utils/schema-slimmer.js');

describe('schema-slimmer — strip nested depth from outputs JsonSchema', () => {
  it('returns undefined for falsy/primitive input', () => {
    assert.equal(slimOutputsSchema(undefined), undefined);
    assert.equal(slimOutputsSchema(null), null);
  });

  it('keeps top-level type and required', () => {
    const out = slimOutputsSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] });
    assert.equal(out.type, 'object');
    assert.deepEqual(out.required, ['a']);
  });

  it('slims every property to {type} + passthrough const/enum only', () => {
    const out = slimOutputsSchema({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 3, description: 'nope' },
        b: { type: 'number', const: 42, description: 'drop' },
        c: { type: 'string', enum: ['x', 'y'] },
      },
    });
    assert.deepEqual(out.properties.a, { type: 'string' });
    assert.deepEqual(out.properties.b, { type: 'number', const: 42 });
    assert.deepEqual(out.properties.c, { type: 'string', enum: ['x', 'y'] });
  });

  it('drops nested properties/items/anyOf structure', () => {
    const out = slimOutputsSchema({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { deep: { type: 'string' } },
          required: ['deep'],
        },
        arr: { type: 'array', items: { type: 'string' } },
      },
    });
    assert.deepEqual(out.properties.nested, { type: 'object' });
    assert.deepEqual(out.properties.arr, { type: 'array' });
  });

  it('preserves non-object property values as-is (edge)', () => {
    const out = slimOutputsSchema({ type: 'object', properties: { x: true } });
    assert.equal(out.properties.x, true);
  });

  it('does not mutate the input object', () => {
    const inp = { type: 'object', properties: { a: { type: 'string', description: 'x' } } };
    const copy = JSON.parse(JSON.stringify(inp));
    slimOutputsSchema(inp);
    assert.deepEqual(inp, copy);
  });

  it('realistic: slimmed envelope still has every top-level key present', () => {
    const out = slimOutputsSchema({
      type: 'object',
      properties: {
        reference: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/$defs/node' } },
      },
      required: ['reference'],
    });
    assert.deepEqual(Object.keys(out.properties).sort(), ['children', 'name', 'reference']);
    assert.equal(out.properties.reference.type, 'object');
    assert.equal(out.required[0], 'reference');
  });
});
