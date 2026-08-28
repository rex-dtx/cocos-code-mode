'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { trimResponse } = requireDist('utcp/utils/response-trimmer.js');

describe('response-trimmer — trims null/undefined/empty containers before serializing', () => {
  it('keeps primitives', () => {
    assert.equal(trimResponse('hello'), 'hello');
    assert.equal(trimResponse(42), 42);
    assert.equal(trimResponse(0), 0);
    assert.equal(trimResponse(false), false);
  });

  it('collapses null/undefined to undefined (stripped by parent)', () => {
    assert.equal(trimResponse(null), undefined);
    assert.equal(trimResponse(undefined), undefined);
  });

  it('keeps non-empty array at root', () => {
    assert.deepEqual(trimResponse([1, 2]), [1, 2]);
  });

  it('returns empty array at root (not stripped — [] means no results)', () => {
    assert.deepEqual(trimResponse([]), []);
  });

  it('strips null/undefined elements inside arrays', () => {
    assert.deepEqual(trimResponse([1, null, 2, undefined, 3]), [1, 2, 3]);
  });

  it('strips empty-array/object values from objects', () => {
    const out = trimResponse({ a: [], b: {}, c: 'keep' });
    assert.deepEqual(out, { c: 'keep' });
  });

  it('strips undefined/null values from objects', () => {
    const out = trimResponse({ a: undefined, b: null, c: 0, d: '' });
    assert.deepEqual(out, { c: 0, d: '' });
  });

  it('returns undefined when every property was stripped (parent drops the key)', () => {
    assert.equal(trimResponse({ a: null, b: [] }), undefined);
  });

  it('recurses: trims empty containers nested inside objects/arrays', () => {
    const out = trimResponse({ outer: { inner: [], keep: 1 }, arr: [{ x: null, y: 1 }] });
    assert.deepEqual(out, { outer: { keep: 1 }, arr: [{ y: 1 }] });
  });

  it('keeps nested non-empty arrays/objects intact', () => {
    const out = trimResponse({ items: [{ id: 'a' }, { id: 'b' }] });
    assert.deepEqual(out, { items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('empty object on its own returns undefined (not {})', () => {
    assert.equal(trimResponse({}), undefined);
  });

  it('realistic tool payload: strips empties without dropping real data', () => {
    const out = trimResponse({
      reference: { id: 'abc', type: 'cc.Node' },
      name: 'Canvas',
      empty: [],
      missing: null,
      components: [{ reference: { id: 'x', type: 'cc.UITransform' } }],
    });
    assert.deepEqual(out, {
      reference: { id: 'abc', type: 'cc.Node' },
      name: 'Canvas',
      components: [{ reference: { id: 'x', type: 'cc.UITransform' } }],
    });
  });
});
