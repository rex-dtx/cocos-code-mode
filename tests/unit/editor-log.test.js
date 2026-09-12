'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { EditorTools } = requireDist('utcp/tools/editor-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withProjectLog(t, content) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-log-'));
  const logDir = path.join(project, 'temp', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  if (content !== undefined) fs.writeFileSync(path.join(logDir, 'project.log'), content);
  const previousEditor = global.Editor;
  global.Editor = { Project: { path: project } };
  t.after(() => { global.Editor = previousEditor; });
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  return project;
}

const sampleLog = [
  '09-12-2026 10:00:00 - info: first message',
  '09-12-2026 10:00:01 - error: needle failure',
  '09-12-2026 10:00:02 - warn: other warning',
].join('\n') + '\n';

function captureConsole(t) {
  const entries = [];
  for (const level of ['log', 'debug', 'info', 'warn', 'error']) {
    t.mock.method(console, level, (...args) => entries.push({ level, args }));
  }
  return entries;
}

function invalid(error) {
  return error instanceof ToolError && error.status === 400 && error.code === 'INVALID_ARGUMENT';
}


describe('editorGetLogs bounded search', () => {
  it('filters by plain-text pattern and returns a valid empty result for no match', async (t) => {
    withProjectLog(t, sampleLog);
    const tool = new EditorTools();
    assert.deepEqual(await tool.editorGetLogs({ pattern: 'needle' }), {
      logLines: ['error: needle failure'], total: 1, truncated: false,
    });
    assert.deepEqual(await tool.editorGetLogs({ pattern: 'absent' }), {
      logLines: [], total: 0, truncated: false,
    });
  });

  it('caps returned serialized UTF-8 bytes and validates new bounds', async (t) => {
    withProjectLog(t, [
      '09-12-2026 10:00:00 - info: ' + 'é'.repeat(500),
      '09-12-2026 10:00:01 - info: second',
    ].join('\n'));
    const result = await new EditorTools().editorGetLogs({ count: 10, maxBytes: 256 });
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 256);
    assert.equal(result.truncated, true);
    for (const maxBytes of [255, 65537, 256.5, '256']) {
      await assert.rejects(() => new EditorTools().editorGetLogs({ maxBytes }), invalid);
    }
    await assert.rejects(() => new EditorTools().editorGetLogs({ pattern: 'x'.repeat(257) }), invalid);
  });

  it('reports unavailable and parse-drift logs explicitly', async (t) => {
    withProjectLog(t);
    await assert.rejects(() => new EditorTools().editorGetLogs(), (error) => error.code === 'LOG_UNAVAILABLE' && error.status === 503);
    withProjectLog(t, 'not a Creator log');
    await assert.rejects(() => new EditorTools().editorGetLogs(), (error) => error.code === 'LOG_PARSE_DRIFT' && error.status === 422);
  });

});

describe('editorLog', () => {
  it('keeps debug visible to the project-log reader and preserves JSON payload text', (t) => {
    const entries = captureConsole(t);
    new EditorTools().editorLog({ level: 'debug', message: '  Agent %s  ', data: { text: 'Tiếng Việt\nnext', ready: false } });
    assert.deepEqual(entries, [{ level: 'log', args: ['[debug] Agent %s {"text":"Tiếng Việt\\nnext","ready":false}'] }]);
  });

  it('rejects blank or oversized messages and unsupported levels without emitting', (t) => {
    const entries = captureConsole(t);
    const tool = new EditorTools();
    for (const args of [{ level: 'info', message: ' \n\t ' }, { level: 'warn', message: 'x'.repeat(4097) }, { level: 'trace', message: 'invalid' }]) {
      assert.throws(() => tool.editorLog(args), invalid);
    }
    assert.deepEqual(entries, []);
  });

  it('enforces the payload limit in UTF-8 bytes, including JSON delimiters', (t) => {
    const entries = captureConsole(t);
    const tool = new EditorTools();
    const data = 'é'.repeat(32767);
    tool.editorLog({ level: 'info', message: 'boundary', data });
    assert.equal(Buffer.byteLength(entries[0].args[0].slice('boundary '.length), 'utf8'), 65536);
    assert.throws(() => tool.editorLog({ level: 'info', message: 'overflow', data: data + 'a' }), invalid);
    assert.equal(entries.length, 1);
  });

  it('rejects unserializable payloads without partial log output', (t) => {
    const entries = captureConsole(t);
    const circular = {}; circular.self = circular;
    for (const data of [circular, 1n, () => {}]) {
      assert.throws(() => new EditorTools().editorLog({ level: 'error', message: 'invalid payload', data }), invalid);
    }
    assert.deepEqual(entries, []);
  });
});
