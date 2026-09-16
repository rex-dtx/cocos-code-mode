'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { UtcpServerManager, setServerProfile } = requireDist('utcp/utcp-server.js');

it('handshake distinguishes readiness, wrong project and hung IPC through HTTP in restricted profiles', async () => {
  const original = global.Editor;
  const project = path.resolve('handshake-project');
  let calls = 0;
  let respond = async () => false;
  global.Editor = { Project: { path: project }, App: { version: '3.7.3' }, Message: { request: () => { calls++; return respond(); } } };
  const first = new UtcpServerManager();
  const second = new UtcpServerManager();
  try {
    const port = await first.start(0);
    const base = `http://127.0.0.1:${port}`;
    async function handshake(args = {}, target = base) {
      const response = await fetch(`${target}/tools/editorHandshake?${new URLSearchParams(args)}`);
      assert.equal(response.status, 200);
      return response.json();
    }
    for (const profile of ['core', 'full', 'custom']) {
      setServerProfile(profile, [], ['editorHandshake']);
      const manual = await (await fetch(`${base}/utcp`)).json();
      assert.ok(manual.tools.some(tool => tool.name === 'editorHandshake'));
      const result = await handshake({ expectedProjectPath: project + path.sep });
      assert.equal(result.projectMatches, true);
      assert.deepEqual(result.probe, { status: 'responsive', sceneReady: false, code: null });
    }
    const wrong = await handshake({ expectedProjectPath: path.resolve('another-project') });
    assert.equal(wrong.projectMatches, false);
    respond = async () => true;
    const ready = await handshake();
    assert.deepEqual(ready.probe, { status: 'responsive', sceneReady: true, code: null });
    assert.equal(ready.projectMatches, null);
    assert.equal(ready.instanceId, wrong.instanceId);
    respond = async () => 'false';
    assert.equal((await handshake()).probe.status, 'invalid-response');
    respond = async () => { throw new Error('scene unavailable'); };
    assert.equal((await handshake()).probe.code, 'EDITOR_IPC_ERROR');
    let release;
    respond = () => new Promise(resolve => { release = resolve; });
    const before = calls;
    for (let i = 0; i < 2; i++) {
      assert.deepEqual((await handshake({ timeoutMs: 5 })).probe, { status: 'timeout', sceneReady: null, code: 'EDITOR_IPC_TIMEOUT' });
    }
    assert.equal(calls, before + 1, 'repeated timeout must not accumulate IPC');
    release(true);
    await new Promise(resolve => setImmediate(resolve));
    respond = async () => true;
    assert.equal((await handshake()).probe.sceneReady, true);
    const otherPort = await second.start(0);
    assert.notEqual((await handshake({}, `http://127.0.0.1:${otherPort}`)).instanceId, ready.instanceId);
    const invalid = await fetch(`${base}/tools/editorHandshake?expectedProjectPath=relative`);
    assert.equal(invalid.status, 400);
  } finally {
    await first.stop();
    await second.stop();
    setServerProfile('full');
    global.Editor = original;
  }
});

it('server restart renews hung probes and late old completion cannot evict a new probe', async () => {
  const original = global.Editor;
  let calls = 0;
  const releases = [];
  global.Editor = { Project: { path: process.cwd() }, App: { version: '3.7.3' }, Message: {
    request: () => { calls++; return new Promise(resolve => releases.push(resolve)); },
  } };
  const first = new UtcpServerManager();
  const second = new UtcpServerManager();
  const probe = async port => (await fetch(`http://127.0.0.1:${port}/tools/editorHandshake?timeoutMs=5`)).json();
  try {
    const port = await first.start(0);
    const before = await probe(port);
    assert.equal(before.probe.status, 'timeout');
    await first.stop();
    const nextPort = await second.start(0);
    const after = await probe(nextPort);
    assert.notEqual(after.instanceId, before.instanceId);
    assert.equal(calls, 2, 'new server must issue a fresh probe');
    releases[0](true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await probe(nextPort)).probe.status, 'timeout');
    assert.equal(calls, 2, 'old completion must not discard current in-flight probe');
    releases[1](true);
    await new Promise(resolve => setImmediate(resolve));
    global.Editor.Message.request = async () => true;
    assert.equal((await probe(nextPort)).probe.status, 'responsive');
  } finally {
    releases.forEach(resolve => resolve(true));
    await first.stop();
    await second.stop();
    global.Editor = original;
  }
});
