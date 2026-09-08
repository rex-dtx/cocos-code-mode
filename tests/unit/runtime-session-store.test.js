'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { RuntimeSessionError, RuntimeSessionStore } = requireDist('utcp/utils/runtime-session-store.js');

describe('RuntimeSessionStore', () => {
  it('attaches idempotently and preserves explicit session identity', () => {
    let now = 100;
    const store = new RuntimeSessionStore(() => now);

    const first = store.attach('browser-preview', 'preview-main');
    const second = store.attach('browser-preview', 'preview-main');

    assert.equal(first.sessionId, 'runtime-1');
    assert.deepEqual(second, first);
    assert.deepEqual(store.list(), [first]);
  });

  it('bounds active sessions and releases capacity only through reset', () => {
    const store = new RuntimeSessionStore(() => 1, 2);
    const first = store.attach('game-view', 'game-a');
    const second = store.attach('simulator', 'sim-a');

    assert.throws(() => store.attach('game-view', 'game-b'), (error) => (
      error instanceof RuntimeSessionError && error.code === 'SESSION_LIMIT'
    ));
    const stopped = store.stop(first.sessionId);
    assert.equal(stopped.status, 'stopped');
    assert.throws(() => store.attach('game-view', 'game-b'), /SESSION_LIMIT|limit reached/);

    store.reset(second.sessionId);
    const replacement = store.attach('game-view', 'game-b');
    assert.equal(replacement.sessionId, 'runtime-3');
  });

  it('rejects stale identities and records stop time exactly once', () => {
    let now = 10;
    const store = new RuntimeSessionStore(() => now);
    const session = store.attach('game-view', 'game-a');

    now = 20;
    const stopped = store.stop(session.sessionId);
    now = 30;
    const stoppedAgain = store.stop(session.sessionId);

    assert.equal(stopped.stoppedAt, 20);
    assert.deepEqual(stoppedAgain, stopped);
    assert.throws(() => store.inspect('runtime-missing'), (error) => (
      error instanceof RuntimeSessionError && error.code === 'SESSION_NOT_FOUND'
    ));
    assert.throws(() => store.attach('invalid', 'target'), /Unsupported runtime target kind/);
  });
});
