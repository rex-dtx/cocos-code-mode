'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { ToolError, toToolErrorResponse } = requireDist('utcp/tool-error.js');

describe('typed UTCP tool errors', () => {
  it('preserves an actionable typed error over HTTP', () => {
    const error = new ToolError({
      code: 'ASSET_TYPE_MISMATCH',
      status: 422,
      message: 'readPrefabJson accepts cc.Prefab; received cc.SceneAsset.',
      details: { expectedTypes: ['cc.Prefab'], actualType: 'cc.SceneAsset' },
      recovery: 'Use sceneSnapshot, nodeGetTree, or inspectorGet for a scene.',
    });

    assert.deepEqual(toToolErrorResponse(error), {
      status: 422,
      body: {
        error: 'readPrefabJson accepts cc.Prefab; received cc.SceneAsset.',
        code: 'ASSET_TYPE_MISMATCH',
        details: { expectedTypes: ['cc.Prefab'], actualType: 'cc.SceneAsset' },
        recovery: 'Use sceneSnapshot, nodeGetTree, or inspectorGet for a scene.',
      },
    });
  });

  it('keeps unknown failures opaque to the caller', () => {
    assert.deepEqual(toToolErrorResponse(new Error('internal detail')), {
      status: 500,
      body: { error: 'Internal tool error.', code: 'INTERNAL_ERROR' },
    });
  });

  it('classifies unsupported editor APIs with a recovery action', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/project-tools.ts'), 'utf8');

    assert.match(source, /code: 'UNSUPPORTED_EDITOR_API'/);
    assert.match(source, /recovery: 'Edit settings\/v2\/packages\/\*\.json directly to change project settings\.'/);
  });
});
