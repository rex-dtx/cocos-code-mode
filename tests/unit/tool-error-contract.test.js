'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

const { ToolError, toToolErrorResponse } = requireDist('utcp/tool-error.js');

describe('typed UTCP tool errors', () => {
  it('preserves an actionable typed error over HTTP', () => {
    const error = new ToolError({
      code: 'ASSET_TYPE_MISMATCH',
      status: 422,
      message: 'readPrefabJson accepts cc.Prefab; received cc.SceneAsset.',
      details: { expectedTypes: ['cc.Prefab'], actualType: 'cc.SceneAsset' },
      recovery: 'Use nodeQuery or inspector dump for a scene.',
    });

    assert.deepEqual(toToolErrorResponse(error), {
      status: 422,
      body: {
        error: 'readPrefabJson accepts cc.Prefab; received cc.SceneAsset.',
        code: 'ASSET_TYPE_MISMATCH',
        details: { expectedTypes: ['cc.Prefab'], actualType: 'cc.SceneAsset' },
        recovery: 'Use nodeQuery or inspector dump for a scene.',
      },
    });
  });

  it('keeps unknown failures opaque to the caller', () => {
    assert.deepEqual(toToolErrorResponse(new Error('internal detail')), {
      status: 500,
      body: { error: 'Internal tool error.', code: 'INTERNAL_ERROR' },
    });
  });

  it('classifies nodeQuery target not found with recovery', () => {
    const source = readSource('utcp/tools-2x/scene-read-tools.ts');
    assert.match(source, /code: 'TARGET_NOT_FOUND'/);
    assert.match(source, /status: 404/);
    assert.match(source, /recovery:[\s\S]*?findNodes/);
  });

  it('server maps ToolError and stamps X-Duration-Ms', () => {
    const source = readSource('utcp/utcp-server.ts');
    assert.match(source, /toToolErrorResponse/);
    assert.match(source, /X-Duration-Ms/);
    assert.match(source, /MISSING_INPUTS/);
    assert.match(source, /validateSchemaArguments/);
  });
});
