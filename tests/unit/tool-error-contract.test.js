'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { ToolError, toToolErrorResponse } = requireDist('utcp/tool-error.js');
const { shouldLogToolError, expectedTestWitnessId, creatorInteractionLog, formatInteractionSummary } = requireDist('utcp/utcp-server.js');


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
  it('keeps expected typed client failures out of Creator error logs', () => {
    assert.equal(shouldLogToolError(new ToolError({
      code: 'TARGET_NOT_FOUND',
      status: 404,
      message: 'Fixture target not found',
    })), false);
    assert.equal(shouldLogToolError(new Error('unexpected failure')), true);
  });
  it('accepts only safe explicit witness markers', () => {
    assert.equal(expectedTestWitnessId({
      'x-ccb-expected-error': 'true',
      'x-ccb-test-id': 'candidate.assetImporterAudit.negative.v1',
    }), 'candidate.assetImporterAudit.negative.v1');
    assert.equal(expectedTestWitnessId({
      'x-ccb-expected-error': 'false',
      'x-ccb-test-id': 'candidate.assetImporterAudit.negative.v1',
    }), undefined);
    assert.equal(expectedTestWitnessId({
      'x-ccb-expected-error': 'true',
      'x-ccb-test-id': 'contains spaces',
    }), undefined);
  });
  it('emits a compact correlated error summary with actionable context', () => {
    assert.equal(
      formatInteractionSummary({
        phase: 'error',
        requestId: '1234567890abcdef',
        tool: 'assetCreate',
        status: 500,
        durationMs: 3,
        code: 'INTERNAL_ERROR',
        message: 'asset already exists\nUse the existing asset.',
      }),
      '[cx3][api][12345678] FAILED assetCreate 500 · 3ms INTERNAL_ERROR\nMessage:\n  asset already exists Use the existing asset.',
    );
  });

  it('emits lifecycle summaries once through the Creator console without raw JSON', () => {
    const prior = global.Editor;
    const calls = [];
    global.Editor = {
      info: (message) => calls.push(['info', message]),
      warn: (message) => calls.push(['warn', message]),
      error: (message) => calls.push(['error', message]),
    };
    try {
      creatorInteractionLog({ phase: 'complete', requestId: 'abcdef0123456789', tool: 'editorState', status: 200, durationMs: 4 });
      assert.deepEqual(calls, [['info', '[cx3][api][abcdef01] SUCCESS editorState 200 · 4ms']]);
      assert.equal(calls[0][1].includes('|'), false);
      assert.equal(calls[0][1].includes('"requestId"'), false);
    } finally {
      global.Editor = prior;
    }
  });

  it('classifies unsupported editor APIs with a recovery action', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/project-tools.ts'), 'utf8');

    assert.match(source, /code: 'UNSUPPORTED_EDITOR_API'/);
    assert.match(source, /recovery: 'Edit settings\/v2\/packages\/\*\.json directly to change project settings\.'/);
  });

  it('classifies nodeGetTree target not found and composite handles with recovery', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/scene-tools.ts'), 'utf8');

    assert.match(source, /code: 'TARGET_NOT_FOUND'/);
    assert.match(source, /status: 404/);
    assert.match(source, /code: 'COMPOSITE_HANDLE_NOT_SUPPORTED'/);
    assert.match(source, /status: 400/);
    assert.match(source, /recovery:[\s\S]*?sceneGetInfo/);
  });
});
