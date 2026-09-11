'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.resolve(__dirname, '..', '..', 'scripts', 'verify-release-set.js');

test('release verifier fails closed when the release origin is not configured', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, CCB_RELEASE_DIRECTORY: fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-verify-')), CCB_RELEASE_ORIGIN: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CCB_RELEASE_ORIGIN/);
});
