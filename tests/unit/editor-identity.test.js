'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};
const { UtcpConfigManager } = require('../../source/utcp/config-manager.ts');
const { EditorHandshakeTools } = require('../../source/utcp/tools-2x/editor-handshake-tools.ts');
const { UtcpServerManager } = require('../../source/utcp/utcp-server.ts');

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const project = path.resolve('sample-project');

async function withRegistry(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp2x-identity-'));
  const config = Object.create(UtcpConfigManager.prototype);
  config.configPath = path.join(dir, 'registry.json');
  try { await run(config); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('2x editor identity and registry ownership', () => {
  it('publishes distinct namespaces without replacing a live owner, including concurrent writes', async () => withRegistry(async config => {
    await Promise.all([
      config.ensureCocosEditorTemplate(43112, A, project),
      config.ensureCocosEditorTemplate(43113, B, path.resolve('other-project')),
    ]);
    const registry = config.readConfig();
    assert.deepEqual(registry.manual_call_templates.map(t => t.name).sort(), ['ccp2x_43112', 'ccp2x_43113']);
    assert.equal(registry.variables.CCP2X_OWNER_43112, A);
    assert.equal(registry.variables.CCP2X_OWNER_43113, B);
    await assert.rejects(config.ensureCocosEditorTemplate(43112, B, project), /another editor instance/);
    const tampered = config.readConfig();
    tampered.manual_call_templates.find(t => t.name === 'ccp2x_43112').url = 'http://localhost:43114/utcp';
    fs.writeFileSync(config.getConfigPath(), JSON.stringify(tampered));
    await assert.rejects(config.ensureCocosEditorTemplate(43112, A, project), /no longer points/);
    assert.equal(await config.removeCocosEditorTemplate(43112, A), false);
    assert.equal(config.readConfig().manual_call_templates.find(t => t.name === 'ccp2x_43112').url, 'http://localhost:43114/utcp');
    await assert.rejects(config.ensureCocosEditorTemplate(43112, A, path.resolve('other-project')), /another project/);
    assert.equal(config.readConfig().variables.CCP2X_OWNER_43112, A);
  }));

  it('refuses stale owner deletion and treats old bridge alias as foreign occupancy', async () => withRegistry(async config => {
    fs.writeFileSync(config.getConfigPath(), JSON.stringify({ manual_call_templates: [
      { name: 'cc-bridge-2x', url: 'http://localhost:43113/utcp' },
    ] }));
    await config.ensureCocosEditorTemplate(43112, A, project);
    await assert.rejects(config.ensureCocosEditorTemplate(43113, B, path.resolve('other-project')), /unowned takeover/);
    assert.equal(await config.removeCocosEditorTemplate(43112, B), false);
    assert.equal(config.readConfig().manual_call_templates.find(t => t.name === 'cc-bridge-2x').url, 'http://localhost:43113/utcp');
    assert.equal(config.readConfig().variables.CCP2X_OWNER_43112, A);
    assert.equal(await config.removeCocosEditorTemplate(43112, A), true);
    assert.equal(config.readConfig().variables.CCP2X_OWNER_43112, undefined);
  }));
  it('never claims a port with historical per-port owner markers', async () => withRegistry(async config => {
    fs.writeFileSync(config.getConfigPath(), JSON.stringify({
      manual_call_templates: [{ name: 'ccb2x_43112', url: 'http://localhost:43112/utcp' }],
      variables: { CCB2X_OWNER_43112: B, CCB2X_PROJECT_43112: path.resolve('old-project') },
    }));
    await assert.rejects(config.ensureCocosEditorTemplate(43112, A, project), /Legacy registration/);
    assert.equal(config.readConfig().manual_call_templates.some(t => t.name === 'ccp2x_43112'), false);
  }));

  it('preserves owner and endpoint when a stale panel saves an old registry snapshot', async () => withRegistry(async config => {
    const stale = config.readConfig();
    await config.ensureCocosEditorTemplate(43112, A, project);
    stale.manual_call_templates.push({ name: 'custom', url: 'http://localhost:7777/utcp' });
    await config.writeConfig(stale);
    assert.equal(config.readConfig().variables.CCP2X_OWNER_43112, A);
    await assert.rejects(config.writeConfig({ manual_call_templates: [{ name: 'ccp2x_43112', url: 'http://localhost:9000/utcp' }] }), /reserved template/);
    assert.equal(config.readConfig().variables.CCP2X_OWNER_43112, A);
    assert.equal(config.readConfig().manual_call_templates.find(t => t.name === 'ccp2x_43112').url, 'http://localhost:43112/utcp');
  }));


  it('requires an absolute expected project and rejects mismatch before panel IPC', async () => {
    let ipcCalls = 0;
    const prior = global.Editor;
    global.Editor = {
      Project: { path: project }, versions: { CocosCreator: '2.4.15' },
      Scene: { callSceneScript(pkg, message, callback) {
        ipcCalls++;
        assert.equal(pkg, 'cocos-pilot-2x');
        assert.equal(message, 'scene-info');
        callback(null, { name: 'Scene2x', uuid: 'scene-id' });
      } },
    };
    try {
      const handshake = new EditorHandshakeTools(A);
      await assert.rejects(handshake.editorHandshake({ expectedProjectPath: path.resolve('wrong-project') }), error => error.code === 'PROJECT_MISMATCH');
      assert.equal(ipcCalls, 0);
      const result = await handshake.editorHandshake({ expectedProjectPath: project });
      assert.equal(result.instanceId, A);
      assert.equal(result.projectMatches, true);
      assert.deepEqual(result.probe, { status: 'responsive', sceneReady: true });
      assert.equal(ipcCalls, 1);
    } finally { global.Editor = prior; }
  });
  it('serves a read-only handshake at the bound endpoint with fresh restart identity', async () => {
    const previous = global.Editor;
    global.Editor = { Project: { path: project }, versions: { CocosCreator: '2.4.15' },
      Scene: { callSceneScript(_pkg, _message, callback) { callback(new Error('no scene open')); } } };
    const first = new UtcpServerManager();
    const second = new UtcpServerManager();
    try {
      const port = await first.start(0);
      const manual = await (await fetch(`http://127.0.0.1:${port}/utcp`)).json();
      assert.equal(manual.tools.some(tool => tool.name === 'editorHandshake'), true);
      const response = await fetch(`http://127.0.0.1:${port}/tools/editorHandshake?expectedProjectPath=${encodeURIComponent(project)}`);
      const result = await response.json();
      assert.equal(response.status, 200);
      assert.equal(result.instanceId, first.instanceId);
      assert.equal(result.projectMatches, true);
      assert.deepEqual(result.probe, { status: 'responsive', sceneReady: false });
      await first.stop();
      assert.equal(first.port, 0);
      assert.notEqual(second.instanceId, first.instanceId);
    } finally {
      await first.stop();
      await second.stop();
      global.Editor = previous;
    }
  });
});
