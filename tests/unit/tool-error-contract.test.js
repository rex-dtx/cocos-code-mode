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
      'x-ccp-expected-error': 'true',
      'x-ccp-test-id': 'candidate.assetImporterAudit.negative.v1',
    }), 'candidate.assetImporterAudit.negative.v1');
    assert.equal(expectedTestWitnessId({
      'x-ccp-expected-error': 'false',
      'x-ccp-test-id': 'candidate.assetImporterAudit.negative.v1',
    }), undefined);
    assert.equal(expectedTestWitnessId({
      'x-ccp-expected-error': 'true',
      'x-ccp-test-id': 'contains spaces',
    }), undefined);
  });
  it('preserves diagnostic lines and redacts nested secrets without changing params', () => {
    const args = { count: 0, enabled: false, password: 'secret-value', nested: { api_key: 'private-key', text: 'first\nsecond' } };
    const output = formatInteractionSummary({ phase: 'error', tool: 'probe', args, message: 'failure\ncause', code: 'INTERNAL_ERROR' });
    assert.ok(output.includes('count: 0'));
    assert.ok(output.includes('enabled: false'));
    assert.ok(output.includes('first\n'));
    assert.ok(output.includes('second'));
    assert.ok(output.includes('cause'));
    assert.ok(output.includes('[REDACTED]'));
    assert.ok(!output.includes('secret-value'));
    assert.ok(!output.includes('private-key'));
    assert.equal(args.password, 'secret-value');
  });

  it('bounds single-line payloads and reports truncation', () => {
    const output = formatInteractionSummary({ phase: 'complete', result: { data: 'a'.repeat(1000000) } });
    assert.ok(output.length < 16000);
    assert.ok(output.includes('truncated'));
  });

  it('writes lifecycle summaries to the standard console and Creator editor logger', () => {
    const prior = global.Editor;
    const calls = [];
    const consoleInfo = console.info;
    global.Editor = {
      info: (message) => calls.push(['editor', 'info', message]),
      warn: (message) => calls.push(['editor', 'warn', message]),
      error: (message) => calls.push(['editor', 'error', message]),
    };
    console.info = (message) => calls.push(['console', 'info', message]);
    try {
      creatorInteractionLog({ phase: 'complete', requestId: 'abcdef0123456789', tool: 'editorState', status: 200, durationMs: 4 });
      assert.deepEqual(calls, [
        ['console', 'info', '[cx3][api][abcdef01] SUCCESS editorState 200 · 4ms'],
        ['editor', 'info', '[cx3][api][abcdef01] SUCCESS editorState 200 · 4ms'],
      ]);
    } finally {
      console.info = consoleInfo;
      global.Editor = prior;
    }
  });

  it('does not expose raw request metadata when mirroring verbose output', () => {
    const prior = global.Editor;
    const calls = [];
    const consoleInfo = console.info;
    global.Editor = { info: (message) => calls.push(message) };
    console.info = (message) => calls.push(message);
    try {
      creatorInteractionLog({ phase: 'complete', requestId: 'abcdef0123456789', tool: 'editorState', status: 200, durationMs: 4, args: { token: 'secret' } });
      assert.equal(calls.length, 2);
      assert.ok(calls.every(message => !message.includes('secret')));
      assert.ok(calls.every(message => !message.includes('"requestId"')));
    } finally {
      console.info = consoleInfo;
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
