'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const verbose = requireDist('utcp/utils/verbose.js');

describe('verbose — shared ceilings for verbose=true', () => {
  it('exports all expected constants', () => {
    for (const k of ['VERBOSE_FILE_BYTES', 'VERBOSE_PREFAB_BYTES', 'VERBOSE_TREE_NODES', 'VERBOSE_TREE_DEPTH', 'VERBOSE_SEARCH_LIMIT', 'VERBOSE_DIAGNOSTICS_LIMIT']) {
      assert.ok(k in verbose, `missing ${k}`);
    }
  });

  it('values are numbers and bounded (not unbounded)', () => {
    for (const k of Object.keys(verbose)) {
      assert.equal(typeof verbose[k], 'number', k);
      assert.ok(verbose[k] > 0 && verbose[k] < 1_000_000_000, `${k}=${verbose[k]} unreasonable`);
    }
  });

  it('tree nodes/depth are generous but not OOM', () => {
    assert.ok(verbose.VERBOSE_TREE_NODES >= 1000);
    assert.ok(verbose.VERBOSE_TREE_NODES <= 20000);
    assert.ok(verbose.VERBOSE_TREE_DEPTH >= 10);
    assert.ok(verbose.VERBOSE_TREE_DEPTH <= 200);
  });

  it('file bytes is 10 MiB', () => {
    assert.equal(verbose.VERBOSE_FILE_BYTES, 10 * 1024 * 1024);
    assert.equal(verbose.VERBOSE_PREFAB_BYTES, 10 * 1024 * 1024);
  });
});
