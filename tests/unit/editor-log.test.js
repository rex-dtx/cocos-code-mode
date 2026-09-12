'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { EditorTools } = requireDist('utcp/tools/editor-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

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
