'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { BuildTools } = requireDist('utcp/tools/build-tools.js');

afterEach(() => { delete global.Editor; });

describe('buildLogInspect', () => {
  it('queries one task and normalizes bounded diagnostics without dispatching a build', async () => {
    const calls = [];
    global.Editor = { Message: { request: async (...args) => {
      calls.push(args);
      return {
        id: 'task-1', progress: 0.75, state: 'failure', message: 'Build failed', stage: 'build',
        detailMessage: [
          { level: 'error', code: 'E_BUILD', file: 'assets/main.ts', line: 12, message: 'Compilation failed' },
          'assets/other.ts(7,2): warning TS999: Deprecated API',
          'informational note',
        ],
        options: { taskName: 'candidate-build', platform: 'web-mobile' },
      };
    } } };

    const result = await new BuildTools().buildLogInspect({ taskId: 'task-1', maxEntries: 2, maxBytes: 4096 });
    assert.deepEqual(calls, [['builder', 'query-task', 'task-1']]);
    assert.equal(result.available, true);
    assert.equal(result.terminal, true);
    assert.equal(result.state, 'failure');
    assert.equal(result.progress, 0.75);
    assert.equal(result.count, 2);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.entries[0], { message: 'Compilation failed', severity: 'error', code: 'E_BUILD', file: 'assets/main.ts', line: 12 });
    assert.deepEqual(result.entries[1], { message: 'Deprecated API', severity: 'warning', code: 'TS999', file: 'assets/other.ts', line: 7 });
  });

  it('reports exposed task state with unavailable logs and never fabricates entries', async () => {
    global.Editor = { Message: { request: async () => ({ id: 'task-2', progress: 1, state: 'success' }) } };
    const result = await new BuildTools().buildLogInspect({ taskId: 2 });
    assert.equal(result.available, false);
    assert.deepEqual(result.entries, []);
    assert.equal(result.count, 0);
    assert.equal(result.truncated, false);
  });

  it('enforces the serialized diagnostics byte bound', async () => {
    global.Editor = {
      Message: {
        request: async () => ({
          id: 'task-bytes', progress: 1, state: 'success',
          logs: [`error E_TOO_LONG: ${'x'.repeat(600)}`],
        }),
      },
    };
    const result = await new BuildTools().buildLogInspect({ taskId: 'task-bytes', maxBytes: 256 });
    assert.equal(result.available, true);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result.entries), 'utf8') <= 256);
  });
  it('rejects malformed task summaries and skips unusable log fields', async () => {
    global.Editor = { Message: { request: async () => ({
      id: 'task-valid', progress: 0.5, state: 'success',
      logs: { unsupported: true },
      detailMessage: [{ message: 'usable diagnostic' }],
    }) } };
    const result = await new BuildTools().buildLogInspect({ taskId: 'task-valid' });
    assert.deepEqual(result.entries, [{ message: 'usable diagnostic' }]);
    global.Editor = { Message: { request: async () => ({ id: 'bad', progress: 'bad', state: 'success' }) } };
    await assert.rejects(new BuildTools().buildLogInspect({ taskId: 'bad' }), (error) => error.code === 'BUILD_TASK_INVALID_RESPONSE' && error.status === 502);
  });


  it('returns typed not-found and query failures', async () => {
    global.Editor = { Message: { request: async () => null } };
    await assert.rejects(new BuildTools().buildLogInspect({ taskId: 'missing' }), (error) => error.code === 'TARGET_NOT_FOUND' && error.status === 404);
    global.Editor = { Message: { request: async () => { throw new Error('builder offline'); } } };
    await assert.rejects(new BuildTools().buildLogInspect({ taskId: 'offline' }), (error) => error.code === 'BUILD_TASK_QUERY_FAILED' && error.status === 502);
  });
});
