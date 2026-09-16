'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { SessionPresenceStore, SessionPresenceError } = requireDist('utcp/session-presence.js');

describe('SessionPresenceStore', () => {
  it('tracks independent sessions and monotonic age/status', () => {
    let now = { wall: 1000, mono: 0 };
    const store = new SessionPresenceStore('i1', () => now);
    store.heartbeat({ sessionId: 'a', expectedInstanceId: 'i1', transport: 'http-helper' });
    store.heartbeat({ sessionId: 'b', expectedInstanceId: 'i1', transport: 'code-mode', label: 'B' });
    now = { wall: 2000, mono: 16000 };
    const rows = store.snapshot();
    assert.equal(rows[0].status, 'Stale');
    assert.equal(rows[0].ageMs, 16000);
    assert.equal(rows[0].lastSeen, 1000);
    assert.equal(rows[1].sessionId, 'b');
  });

  it('rejects malformed input and instance mismatch', () => {
    const store = new SessionPresenceStore('i1', () => 0);
    assert.throws(() => store.heartbeat(null), SessionPresenceError);
    assert.throws(() => store.heartbeat({ sessionId: 'a', expectedInstanceId: 'wrong', transport: 'http-helper' }), /does not match/);
    assert.throws(() => store.heartbeat({ sessionId: 'a', expectedInstanceId: 'i1', transport: 'http-helper', extra: true }), /Unknown field/);
    assert.throws(() => store.heartbeat({ sessionId: 'a\nb', expectedInstanceId: 'i1', transport: 'http-helper' }), /printable/);
  });

  it('closes only matching session and expires without timers', () => {
    let now = 0;
    const store = new SessionPresenceStore('i1', () => now);
    store.heartbeat({ sessionId: 'a', expectedInstanceId: 'i1', transport: 'http-helper' });
    store.heartbeat({ sessionId: 'b', expectedInstanceId: 'i1', transport: 'http-helper' });
    store.heartbeat({ sessionId: 'a', expectedInstanceId: 'i1', transport: 'http-helper', operation: 'close' });
    assert.deepEqual(store.snapshot().map(row => row.sessionId), ['b']);
    now = 61001;
    assert.equal(store.snapshot()[0].status, 'Expired');
    store.heartbeat({ sessionId: 'new', expectedInstanceId: 'i1', transport: 'http-helper' });
    assert.equal(store.snapshot().find(row => row.sessionId === 'b').status, 'Expired', 'new sessions must not erase useful expired history while capacity remains');
    now = 400001;
    assert.deepEqual(store.snapshot(), []);
  });
  it('bounds active sessions and reclaims expired slots on admission', () => {
    let now = 0;
    const store = new SessionPresenceStore('i1', () => now);
    for (let i = 0; i < 100; i++) store.heartbeat({ sessionId: String(i), expectedInstanceId: 'i1', transport: 'http-helper' });
    assert.throws(() => store.heartbeat({ sessionId: 'new', expectedInstanceId: 'i1', transport: 'http-helper' }), error => error.status === 429);
    now = 61000;
    store.heartbeat({ sessionId: 'new', expectedInstanceId: 'i1', transport: 'http-helper' });
    assert.deepEqual(store.snapshot().map(row => row.sessionId), ['new']);
  });
});
