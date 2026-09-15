'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { selectBase } = require('../../scripts/audit-live-qualification');

const originalFetch = global.fetch;
const originalBase = process.env.UTCP_BASE;
const originalExpectedScene = process.env.UTCP_EXPECT_SCENE_UUID;
const originalExpectedCommit = process.env.UTCP_EXPECT_COMMIT;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.UTCP_BASE;
  else process.env.UTCP_BASE = originalBase;
  if (originalExpectedScene === undefined) delete process.env.UTCP_EXPECT_SCENE_UUID;
  else process.env.UTCP_EXPECT_SCENE_UUID = originalExpectedScene;
  if (originalExpectedCommit === undefined) delete process.env.UTCP_EXPECT_COMMIT;
  else process.env.UTCP_EXPECT_COMMIT = originalExpectedCommit;
});

test('rejects a healthy bridge serving the wrong artifact commit', async () => {
  process.env.UTCP_BASE = 'http://stale-project.test';
  process.env.UTCP_EXPECT_COMMIT = 'target-commit';
  global.fetch = async (url) => {
    if (url.endsWith('/utcp')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ commit: 'stale-commit' }), { status: 200 });
  };

  assert.equal(await selectBase(), null);
});

test('rejects a healthy bridge serving the wrong scene', async () => {
  process.env.UTCP_BASE = 'http://wrong-project.test';
  process.env.UTCP_EXPECT_SCENE_UUID = 'target-scene';
  global.fetch = async (url) => {
    if (url.endsWith('/utcp')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ currentScene: { uuid: 'wrong-scene' } }), { status: 200 });
  };

  assert.equal(await selectBase(), null);
});

test('accepts a healthy bridge serving the requested scene', async () => {
  process.env.UTCP_BASE = 'http://target-project.test';
  process.env.UTCP_EXPECT_SCENE_UUID = 'target-scene';
  global.fetch = async (url) => {
    if (url.endsWith('/utcp')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ currentScene: { uuid: 'target-scene' } }), { status: 200 });
  };

  assert.equal(await selectBase(), 'http://target-project.test');
});
