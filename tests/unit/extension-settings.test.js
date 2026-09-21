'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

it('settings validates before mutation and moves only this editor between registry paths', async () => {
  const previous = global.Editor;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-settings-'));
  const first = path.join(dir, 'first.json');
  const second = path.join(dir, 'second.json');
  const values = { utcpConfigPath: first, fixedServerPort: 0 };
  global.Editor = { Project: { path: dir }, App: { version: '3.7.3' },
    Profile: { getConfig: async (_, key) => values[key], setConfig: async (_, key, value) => { values[key] = value; } },
    Message: { request: async () => true, broadcast() {} } };
  const { methods, unload } = requireDist('main.js');
  try {
    await assert.rejects(methods.saveExtensionSettings({ fixedPort: -1, configPath: first }));
    assert.equal(fs.existsSync(first), false);
    await methods.saveExtensionSettings({ fixedPort: 0, configPath: first });
    const before = await methods.getExtensionStatus();
    assert.equal(before.http.status, 'ok');
    await assert.rejects(methods.saveExtensionSettings({ fixedPort: 0, configPath: 'relative.json' }));
    assert.equal((await methods.getExtensionStatus()).server.instanceId, before.server.instanceId);
    await methods.saveExtensionSettings({ fixedPort: 0, configPath: second });
    const after = await methods.getExtensionStatus();
    assert.equal(after.http.status, 'ok');
    assert.notEqual(after.server.instanceId, before.server.instanceId);
    assert.equal(JSON.parse(fs.readFileSync(first)).manual_call_templates.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(second)).manual_call_templates[0].name, after.server.namespace);
    assert.deepEqual(await methods.getExtensionSettings(), { fixedPort: 0, configPath: second });
  } finally { await unload(); global.Editor = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});
