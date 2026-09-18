'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { RequestActivityStore } = requireDist('utcp/request-activity.js');

it('tracks bounded business request activity without payloads', () => {
  let now = 1000;
  const store = new RequestActivityStore(() => now);
  assert.equal(store.start('r1', 'nodeGetTree'), true);
  now = 1250;
  assert.deepEqual(store.snapshot(), {
    activeCount: 1,
    active: [{ requestId: 'r1', tool: 'nodeGetTree', startedAt: 1000, ageMs: 250 }],
    overflowCount: 0,
    lastFinished: null,
  });
  now = 1400;
  store.finish('r1', 'nodeGetTree', 'completed', 200, 1000);
  assert.deepEqual(store.snapshot(), {
    activeCount: 0,
    active: [],
    overflowCount: 0,
    lastFinished: { requestId: 'r1', tool: 'nodeGetTree', outcome: 'completed', status: 200, finishedAt: 1400, durationMs: 400 },
  });
});

it('excludes heartbeat and health traffic from Processing', () => {
  const store = new RequestActivityStore(() => 1000);
  assert.equal(store.start('h1', 'editorHandshake'), false);
  assert.equal(store.start('h2', 'editorSessionHeartbeat'), false);
  store.finish('h1', 'editorHandshake', 'completed', 200, 1000);
  assert.deepEqual(store.snapshot(), { activeCount: 0, active: [], overflowCount: 0, lastFinished: null });
});

it('bounds visible requests while retaining the exact active count', () => {
  const store = new RequestActivityStore(() => 1000);
  for (let index = 0; index < 25; index++) store.start(`r${index}`, `tool${index}`);
  const active = store.snapshot();
  assert.equal(active.activeCount, 25);
  assert.equal(active.active.length, 20);
  assert.equal(active.overflowCount, 5);
  store.finish('r24', 'tool24', 'failed', 500, 900);
  assert.equal(store.snapshot().activeCount, 24);
  store.clear();
  assert.deepEqual(store.snapshot(), { activeCount: 0, active: [], overflowCount: 0, lastFinished: null });
});
