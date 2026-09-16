'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { requireDist } = require('../helpers/require-dist');
const { UtcpConfigManager } = requireDist('utcp/config-manager.js');
const { UtcpClientConfigSerializer } = require('@utcp/sdk');
require('@utcp/http');

it('concurrent processes preserve all editor endpoints and ownership; late cleanup cannot remove a replacement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-registry-'));
  const configPath = path.join(dir, 'config.json');
  const modulePath = path.resolve(__dirname, '../../dist/utcp/config-manager.js');
  const other = { name: 'other', call_template_type: 'http', url: 'http://localhost:3000/utcp', http_method: 'GET' };
  fs.writeFileSync(configPath, JSON.stringify({ variables: { USER_VALUE: 'keep' }, manual_call_templates: [other,
    { ...other, name: 'ccb3x', url: 'http://localhost:42000/utcp' },
  ] }));
  const invalidReads = [];
  const reader = setInterval(() => {
    try { JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) { invalidReads.push(error.message); }
  }, 2);
  const worker = `global.Editor={Profile:{setConfig:async()=>{}}};const {UtcpConfigManager}=require(process.argv[1]);(async()=>{const m=UtcpConfigManager.getInstance();await m.setConfigPath(process.argv[2]);await m.ensureCocosEditorTemplate(Number(process.argv[3]),process.argv[4]);})().catch(e=>{console.error(e);process.exitCode=1});`;
  try {
    await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
      execFile(process.execPath, ['-e', worker, modulePath, configPath, String(42001 + i), String(i + 1).padStart(32, '0')],
        (error, stdout, stderr) => error ? reject(new Error(stdout + stderr)) : resolve());
    })));
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(config.manual_call_templates.map(t => t.name).sort(), ['other', ...Array.from({ length: 9 }, (_, i) => `ccb3x_${42000 + i}`)].sort());
    assert.equal(config.variables.USER_VALUE, 'keep');
    new UtcpClientConfigSerializer().validateDict(config);
    assert.deepEqual(invalidReads, [], 'readers must never see a partial registry');
    const original = global.Editor;
    global.Editor = { Profile: { setConfig: async () => {} } };
    try {
      const manager = UtcpConfigManager.getInstance();
      await manager.setConfigPath(configPath);
      const oldId = '1'.padStart(32, '0');
      const newId = 'a'.repeat(32);
      await manager.ensureCocosEditorTemplate(42001, newId);
      await manager.setConfigPath(path.join(dir, 'other-config.json'));
      assert.equal(await manager.removeCocosEditorTemplate(42001, oldId, configPath), false);
      await manager.setConfigPath(configPath);
      assert.equal(await manager.removeCocosEditorTemplate(42001, oldId), false);
      assert.ok(manager.readConfig().manual_call_templates.some(t => t.name === 'ccb3x_42001'));
      await manager.removeCocosEditorTemplate(42001, newId);
      assert.equal(manager.readConfig().manual_call_templates.some(t => t.name === 'ccb3x_42001'), false);
      assert.ok(manager.readConfig().manual_call_templates.some(t => t.name === 'ccb3x_42002'));
      assert.equal(manager.readConfig().manual_call_templates.some(t => t.name === 'ccb3x'), false);
    } finally { global.Editor = original; }
  } finally { clearInterval(reader); fs.rmSync(dir, { recursive: true, force: true }); }
});

it('invalid registry is preserved rather than overwritten by publication', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-broken-registry-'));
  const configPath = path.join(dir, 'config.json');
  const original = global.Editor;
  global.Editor = { Profile: { setConfig: async () => {} } };
  try {
    fs.writeFileSync(configPath, '{broken');
    const manager = UtcpConfigManager.getInstance();
    await manager.setConfigPath(configPath);
    await assert.rejects(manager.ensureCocosEditorTemplate(42100, 'b'.repeat(32)));
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{broken');
    assert.equal(fs.existsSync(configPath + '.ccb-lock'), false);
  } finally { global.Editor = original; fs.rmSync(dir, { recursive: true, force: true }); }
});

it('auto ports ignore previously persisted bound ports; fixed ports require explicit configuration', async () => {
  const original = global.Editor;
  const values = { serverPort: 49999 };
  global.Editor = { Profile: { getConfig: async (_, key) => values[key], setConfig: async (_, key, value) => { values[key] = value; } } };
  try {
    const manager = UtcpConfigManager.getInstance();
    assert.equal(await manager.getCurrentPort(), 0);
    await manager.setConfiguredPort(42500);
    assert.equal(await manager.getCurrentPort(), 42500);
    await manager.setConfiguredPort(0);
    assert.equal(await manager.getCurrentPort(), 0);
    await assert.rejects(manager.setConfiguredPort(-1));
  } finally { global.Editor = original; }
});
