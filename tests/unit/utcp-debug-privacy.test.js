'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp2x-debug-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.UTCP_DEBUG = '1';
const { snapshotLog } = requireDist('utcp/log-snapshot.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { UtcpServerManager } = requireDist('utcp/utcp-server.js');

test('debug snapshot redacts nested keys and bounds hostile values without executing accessors', () => {
  let accessed = false;
  let serialized = false;
  const input = { auth: 'top-secret', nested: { api_token: 'nested-secret', keep: 42 }, binary: Buffer.from('binary-secret') };
  Object.defineProperty(input.nested, 'sneaky', { enumerable: true, get() { accessed = true; throw Error('getter-secret'); } });
  input.self = input;
  input.toJSON = () => { serialized = true; throw Error('tojson-secret'); };
  const snapshot = snapshotLog({ args: input, oversized: 'x'.repeat(400000) });
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.equal(snapshot.args.auth, '[REDACTED]');
  assert.equal(snapshot.args.nested.api_token, '[REDACTED]');
  assert.equal(snapshot.args.nested.keep, 42);
  assert.match(snapshot.args.nested.sneaky, /accessor/);
  assert.match(snapshot.args.binary, /binary payload/);
  assert.match(snapshot.args.self, /circular reference/);
  assert.equal(snapshot.detailTruncated, true);
  assert.ok(serializedSnapshot.length < 300000);
  assert.equal(accessed, false);
  assert.equal(serialized, false);
  for (const secret of ['top-secret', 'nested-secret', 'binary-secret', 'getter-secret', 'tojson-secret']) {
    assert.equal(serializedSnapshot.includes(secret), false);
  }
  assert.equal(input.auth, 'top-secret');
});

test('debug HTTP route preserves results and error records without leaking secrets or typed refusal stacks', async () => {
  const toolName = `privacyProbe${process.pid}`;
  ToolRegistry.register({
    target: { constructor: class PrivacyProbe {} },
    method: async function ({ nested }) { return { success: true, nested: { sessionToken: nested.sessionToken, value: nested.value } }; },
    tool: {
      name: toolName, description: 'Local privacy smoke tool',
      inputs: { type: 'object', properties: { nested: { type: 'object' } }, required: ['nested'] },
      outputs: { type: 'object', properties: { success: { type: 'boolean' }, nested: { type: 'object' } } },
      tags: [],
      tool_call_template: { call_template_type: 'http', http_method: 'POST', request_body_format: 'json', url: `/tools/${toolName}`, content_type: 'application/json' },
    },
  });
  fs.writeFileSync(path.join(home, 'file.txt'), 'known response', 'utf8');
  global.Editor = { Project: { path: home } };
  const manager = new UtcpServerManager();
  const errors = [];
  const priorError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    const port = await manager.start(0);
    const base = `http://127.0.0.1:${port}`;
    const success = await fetch(`${base}/tools/${toolName}?access_token=query-secret`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nested: { sessionToken: 'body-secret', value: 42 } }),
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { success: true, nested: { sessionToken: 'body-secret', value: 42 } });
    const invalid = await fetch(`${base}/tools/${toolName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'MISSING_INPUTS');
    const refused = await fetch(`${base}/tools/projectReadFile?filePath=.&apiToken=refusal-secret`);
    assert.equal(refused.status, 422);
    assert.equal((await refused.json()).code, 'NOT_A_FILE');
    const file = await fetch(`${base}/tools/projectReadFile?filePath=file.txt`);
    assert.equal(file.status, 200);
    assert.equal((await file.json()).content, 'known response');
    const lines = fs.readdirSync(path.join(home, '.utcp-debug')).filter(name => name.endsWith('.jsonl'));
    assert.equal(lines.length, 1);
    const raw = fs.readFileSync(path.join(home, '.utcp-debug', lines[0]), 'utf8');
    const entries = raw.trim().split('\n').map(JSON.parse);
    assert.equal(entries.filter(row => row.type === 'request').length, 4);
    assert.equal(entries.filter(row => row.type === 'response').length, 2);
    assert.equal(entries.filter(row => row.type === 'error').length, 2);
    assert.equal(entries.find(row => row.type === 'request' && row.tool === toolName).args.nested.sessionToken, '[REDACTED]');
    assert.equal(entries.find(row => row.type === 'response' && row.tool === toolName).result.nested.sessionToken, '[REDACTED]');
    assert.equal(entries.find(row => row.type === 'error' && row.status === 422).code, 'NOT_A_FILE');
    assert.equal(entries.find(row => row.type === 'error' && row.status === 400).code, 'MISSING_INPUTS');
    for (const secret of ['query-secret', 'body-secret', 'refusal-secret']) assert.equal(raw.includes(secret), false);
    assert.ok(errors.some(line => line.includes('NOT_A_FILE') && line.includes('HTTP 422')));
    assert.ok(errors.every(line => !line.includes('ToolError:') && !line.includes('at FileTools')));
  } finally {
    console.error = priorError;
    await manager.stop();
    delete global.Editor;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
