'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

test('qualification orchestrator stops before credentials are available', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', 'scripts', 'qualify-protected.js')], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, CCB_MEMBER_CREDENTIAL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CCB_MEMBER_CREDENTIAL/);
});
