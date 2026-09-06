'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { validateAssetBatchQueries } = requireDist('utcp/tools-2x/batch-asset-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

describe('assetBatchQuery — validateAssetBatchQueries', () => {
  it('accepts a single search query', () => {
    const out = validateAssetBatchQueries([{ operation: 'search', pattern: 'db://assets/**/*.png' }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].operation, 'search');
  });

  it('rejects empty queries', () => {
    assert.throws(
      () => validateAssetBatchQueries([]),
      (err) => err instanceof ToolError && err.code === 'INVALID_BATCH' && err.status === 400
    );
  });

  it('rejects more than 100 queries', () => {
    const queries = Array.from({ length: 101 }, () => ({ operation: 'types' }));
    assert.throws(
      () => validateAssetBatchQueries(queries),
      (err) => err instanceof ToolError && err.code === 'INVALID_BATCH'
    );
  });

  it('rejects a missing operation', () => {
    assert.throws(
      () => validateAssetBatchQueries([{ pattern: 'db://assets/**/*' }]),
      (err) => err instanceof ToolError && err.code === 'INVALID_BATCH'
    );
  });

  it('rejects an unknown operation', () => {
    assert.throws(
      () => validateAssetBatchQueries([{ operation: 'depends_on' }]),
      (err) => err instanceof ToolError && err.code === 'INVALID_BATCH'
    );
  });
});
