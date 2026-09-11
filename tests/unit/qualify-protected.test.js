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

test('qualification status reports missing gates without exposing secret values', () => {
  const secret = 'member-secret-must-not-appear';
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', 'scripts', 'qualify-protected.js'), '--status'], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      CCB_MEMBER_CREDENTIAL: secret,
      CCB_EXECUTION_PUBLIC_KEY: 'public-key',
      CCB_EXECUTION_KEY_ID: 'execution-1',
      CCB_PROJECT_ID: '',
      CCB_ADMIN_CREDENTIAL: '',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  const report = JSON.parse(result.stdout);
  assert.equal(report.readyForAutomation, false);
  assert.equal(report.nextBlockedGate, 'release-origin');
  assert.equal(report.checks.find((check) => check.gate === 'member-authentication').configured, true);
  assert.equal(report.checks.find((check) => check.gate === 'project-binding').configured, false);
});
