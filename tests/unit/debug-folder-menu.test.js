'use strict';
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const { requireDist } = require('../helpers/require-dist');

const originalMkdirSync = fs.mkdirSync;
const originalExec = childProcess.exec;

afterEach(() => {
  fs.mkdirSync = originalMkdirSync;
  childProcess.exec = originalExec;
});

describe('openDebugFolder', () => {
  it('creates the debug directory before opening it', () => {
    const calls = { mkdir: [], exec: [] };
    fs.mkdirSync = (directory, options) => calls.mkdir.push({ directory, options });
    childProcess.exec = (command, callback) => {
      calls.exec.push(command);
      callback(null);
    };

    const { methods } = requireDist('main.js');
    methods.openDebugFolder();

    assert.equal(calls.mkdir.length, 1);
    assert.match(calls.mkdir[0].directory, /\.utcp-debug$/);
    assert.deepEqual(calls.mkdir[0].options, { recursive: true });
    assert.equal(calls.exec.length, 1);
  });
});
