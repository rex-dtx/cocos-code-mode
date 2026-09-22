'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const logs = requireDist('utcp/log-path.js');

it('isolates, bounds, and clears one editor log scope', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-log-scope-'));
  try {
    const first = logs.createDebugLogFile(dir, 'utcp', 'first/editor');
    const second = logs.createDebugLogFile(dir, 'scene', 'second-editor');
    assert.match(first, /utcp-firsteditor-/);
    assert.match(second, /scene-second-editor-/);
    logs.appendJsonl(first, { token: 'secret', value: 'logged through snapshot upstream' });
    assert.equal(logs.listDebugLogFiles(dir).length, 2);
    assert.equal(logs.clearDebugLogFiles(dir), 2);
    assert.deepEqual(logs.listDebugLogFiles(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
