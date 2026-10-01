'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};

const { SessionPresenceStore, SessionPresenceError } = require('../../source/utcp/session-presence.ts');
const { SessionTools } = require('../../source/utcp/tools-2x/session-tools.ts');

const identity = 'instance-one';
const input = (sessionId, operation = 'beat') => ({ sessionId, expectedInstanceId: identity, transport: 'http-helper', operation });

describe('2x advisory session presence', () => {
  it('uses monotonic age when wall time changes and never reports stale as active', () => {
    let clock = { wall: 100000, mono: 1000 };
    const store = new SessionPresenceStore(identity, () => clock);
    assert.deepEqual(store.heartbeat({ ...input('one'), label: 'Editor helper' }), {
      sessionId: 'one', label: 'Editor helper', transport: 'http-helper', lastSeen: 100000,
      ageMs: 0, status: 'Active',
    });
    clock = { wall: 50000, mono: 16000 };
    assert.equal(store.snapshot()[0].status, 'Active', '15 seconds remains fresh');
    clock = { wall: 40000, mono: 16001 };
    assert.deepEqual(store.snapshot()[0], {
      sessionId: 'one', label: 'Editor helper', transport: 'http-helper', lastSeen: 100000,
      ageMs: 15001, status: 'Stale',
    });
    clock = { wall: 400000, mono: 61001 };
    assert.equal(store.snapshot()[0].status, 'Expired');
    clock = { wall: 400001, mono: 301001 };
    assert.deepEqual(store.snapshot(), [], 'retained expired sessions eventually age out on reads');
  });

  it('rejects wrong instance without refreshing or closing the matching session', () => {
    let clock = { wall: 1000, mono: 0 };
    const store = new SessionPresenceStore(identity, () => clock);
    store.heartbeat(input('one'));
    clock = { wall: 2000, mono: 16000 };
    assert.throws(() => store.heartbeat({ ...input('one'), expectedInstanceId: 'another' }),
      error => error instanceof SessionPresenceError && error.code === 'INSTANCE_MISMATCH' && error.status === 409);
    assert.throws(() => store.heartbeat({ ...input('one', 'close'), expectedInstanceId: 'another' }),
      error => error.code === 'INSTANCE_MISMATCH');
    assert.equal(store.snapshot()[0].status, 'Stale');
    assert.equal(store.snapshot()[0].lastSeen, 1000);
    assert.equal(store.heartbeat(input('one')).status, 'Active');
    assert.equal(store.heartbeat(input('one', 'close')).status, 'Expired');
    assert.deepEqual(store.snapshot(), []);
  });

  it('bounds entries and reclaims expired slots without timers', () => {
    let clock = { wall: 0, mono: 0 };
    const store = new SessionPresenceStore(identity, () => clock);
    for (let i = 0; i < 100; i++) store.heartbeat(input(String(i)));
    assert.throws(() => store.heartbeat(input('extra')),
      error => error.code === 'CAPACITY_EXCEEDED' && error.status === 429);
    assert.equal(store.snapshot().length, 100);
    clock = { wall: 61001, mono: 61001 };
    assert.equal(store.heartbeat(input('extra')).status, 'Active');
    assert.deepEqual(store.snapshot().map(row => row.sessionId), ['extra']);
  });

  it('rejects malformed declarations and exposes typed tool errors', () => {
    const tools = new SessionTools(new SessionPresenceStore(identity, () => ({ wall: 0, mono: 0 })));
    assert.throws(() => tools.editorSessionHeartbeat({ ...input('one'), expectedInstanceId: 'other' }),
      error => error.code === 'INSTANCE_MISMATCH' && error.status === 409);
    assert.throws(() => tools.editorSessionHeartbeat({ ...input('one'), extra: 1 }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    assert.throws(() => tools.editorSessionHeartbeat({ ...input('one'), label: null }),
      error => error.code === 'INVALID_ARGUMENT');
    assert.throws(() => tools.editorSessionHeartbeat({ ...input('bad\nid') }),
      error => error.code === 'INVALID_ARGUMENT');
  });
});
