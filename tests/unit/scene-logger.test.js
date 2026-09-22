'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

it('restores console hooks after scene logger stops and redacts structured secrets', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-scene-log-'));
  const originalHome = os.homedir;
  const originalRequire = global.require;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  os.homedir = () => home;
  global.require = require;
  const scene = requireDist('scene.js');
  t.after(() => {
    void scene.methods.stopCatchAll();
    os.homedir = originalHome;
    global.require = originalRequire;
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(home, { recursive: true, force: true });
  });
  assert.equal(await scene.methods.startCatchAll('test-editor'), true);
  console.log({ token: 'must-not-leak', nested: { password: 'nope' } });
  await scene.methods.stopCatchAll();
  assert.equal(console.log, originalLog);
  const directory = path.join(home, '.utcp-debug', 'instance-test-editor');
  const file = fs.readdirSync(directory).find(name => name.endsWith('.jsonl'));
  const text = fs.readFileSync(path.join(directory, file), 'utf8');
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /must-not-leak|"nope"/);
});
