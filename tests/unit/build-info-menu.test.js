'use strict';
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const originalEditor = global.Editor;
const originalConsoleLog = console.log;

afterEach(() => {
  global.Editor = originalEditor;
  console.log = originalConsoleLog;
});

describe('showBuildInfo', () => {
  it('logs build information without opening an Editor dialog', async () => {
    const logs = [];
    let dialogCalls = 0;
    global.Editor = {
      Dialog: {
        messageBox() { dialogCalls++; },
        info() { dialogCalls++; },
      },
    };
    console.log = (...args) => logs.push(args.join(' '));

    const { methods } = requireDist('main.js');
    await methods.showBuildInfo();

    assert.equal(dialogCalls, 0);
    assert.ok(logs.some((message) => message.includes('Build info:')));
  });
});
