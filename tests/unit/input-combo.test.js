'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { parseKeyCombo } = requireDist('utcp/tools-2x/input-tools.js');

describe('parseKeyCombo', () => {
  it('parses Ctrl+S', () => {
    assert.deepEqual(parseKeyCombo('Ctrl+S'), { key: 'S', modifiers: ['control'] });
  });

  it('parses Ctrl+Shift+D', () => {
    assert.deepEqual(parseKeyCombo('Ctrl+Shift+D'), { key: 'D', modifiers: ['control', 'shift'] });
  });

  it('rejects a combo that ends in a modifier', () => {
    assert.throws(() => parseKeyCombo('Ctrl+'), /modifier/);
  });

  it('rejects an unknown modifier', () => {
    assert.throws(() => parseKeyCombo('Super+D'), /unknown modifier/);
  });
});
