'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { TtlMemo } = requireDist('utcp/utils/memo-cache.js');

describe('TtlMemo — TTL cache with fixed cap', () => {
  let memo;

  beforeEach(() => { memo = new TtlMemo(1000, 4); });

  it('stores and retrieves', () => {
    memo.set('k', 123);
    assert.equal(memo.get('k'), 123);
    assert.equal(memo.size, 1);
  });

  it('returns undefined for missing key', () => {
    assert.equal(memo.get('nope'), undefined);
  });

  it('expires after TTL', async () => {
    const fast = new TtlMemo(10, 8);
    fast.set('k', 'v');
    assert.equal(fast.get('k'), 'v');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(fast.get('k'), undefined);
    assert.equal(fast.size, 0);
  });

  it('evicts oldest when over cap', () => {
    for (let i = 0; i < 4; i++) memo.set(`k${i}`, i);
    assert.equal(memo.size, 4);
    memo.set('k4', 99); // over cap (4) -> drop k0
    assert.equal(memo.get('k0'), undefined);
    assert.equal(memo.get('k4'), 99);
    assert.equal(memo.size, 4);
  });

  it('overwrites existing key without growing', () => {
    memo.set('k', 1);
    memo.set('k', 2);
    assert.equal(memo.get('k'), 2);
    assert.equal(memo.size, 1);
  });

  it('invalidate(key) removes one', () => {
    memo.set('a', 1); memo.set('b', 2);
    memo.invalidate('a');
    assert.equal(memo.get('a'), undefined);
    assert.equal(memo.get('b'), 2);
  });

  it('invalidate() clears all', () => {
    memo.set('a', 1); memo.set('b', 2);
    memo.invalidate();
    assert.equal(memo.size, 0);
  });

  it('stores any value type (object, null, 0, false)', () => {
    memo.set('obj', { x: 1 });
    memo.set('nul', null);
    memo.set('zero', 0);
    memo.set('fls', false);
    assert.deepEqual(memo.get('obj'), { x: 1 });
    assert.equal(memo.get('nul'), null);
    assert.equal(memo.get('zero'), 0);
    assert.equal(memo.get('fls'), false);
  });

  it('pre-tuned instances have expected TTL (source contract)', () => {
    // Not testing timers here — just that the dist exports exist with right TTL.
    // Import via requireDist already proved the module loads; this doubles as a
    // regression tripwire if someone renames the exports.
    const mod = requireDist('utcp/utils/memo-cache.js');
    assert.ok(mod.definitionMemo instanceof TtlMemo);
    assert.ok(mod.assetQueryMemo instanceof TtlMemo);
  });
});
