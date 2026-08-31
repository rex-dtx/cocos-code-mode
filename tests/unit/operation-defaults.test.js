'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('operation defaults', () => {
  it('defaults asset references to used_by', () => {
    assert.match(readSource('utcp/tools/asset-tools.ts'), /const direction = args\.direction \?\? 'used_by';/);
  });

  it('defaults viewport requests to query_viewport', () => {
    assert.match(readSource('utcp/tools/editor-tools.ts'), /const operation = args\.operation \?\? 'query_viewport';/);
  });
});
