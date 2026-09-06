'use strict';
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { isPathInside } = requireDist('utcp/execute/path-safety.js');

describe('path-safety — isPathInside', () => {
  const root = process.platform === 'win32' ? 'C:/proj' : '/tmp/proj';

  it('true for root itself', () => {
    assert.equal(isPathInside(root, root), true);
  });

  it('true for direct child', () => {
    assert.equal(isPathInside(root, path.join(root, 'assets', 'a.json')), true);
  });

  it('true for nested child', () => {
    assert.equal(isPathInside(root, path.join(root, 'a', 'b', 'c.png')), true);
  });

  it('false for parent traversal', () => {
    assert.equal(isPathInside(root, path.join(root, '..', 'other')), false);
  });

  it('false for sibling directory', () => {
    assert.equal(isPathInside(root, path.join(path.dirname(root), 'other')), false);
  });

  it('false for absolute outside', () => {
    const outside = process.platform === 'win32' ? 'C:/Windows/hosts' : '/etc/hosts';
    assert.equal(isPathInside(root, outside), false);
  });

  it('normalizes .. segments', () => {
    const tricky = path.join(root, 'a', '..', 'b', 'x.json');
    assert.equal(isPathInside(root, tricky), true);
  });

  it('empty target is outside', () => {
    assert.equal(isPathInside(root, ''), false);
  });
});
