'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { bindLocalAuthToPort, loadOrCreateLocalAuth } = requireDist('utcp/local-auth.js');
const { getConfigManager } = requireDist('utcp/config-manager.js');

describe('fresh-install local authentication provisioning', () => {
  it('creates one private token file and an exact file-backed per-port template without exposing token bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ccb-local-auth-'));
    const relayInstanceId = '11111111-1111-4111-8111-111111111111';
    const port = 49650;
    const priorEditor = global.Editor;
    const priorLog = console.log;
    const priorError = console.error;
    try {
      global.Editor = { Profile: { async setConfig() {}, async getConfig() { return undefined; } } };
      console.log = () => {};
      console.error = () => {};
      const auth = loadOrCreateLocalAuth(relayInstanceId, join(root, 'auth'));
      bindLocalAuthToPort(auth, port);
      assert.equal(existsSync(auth.tokenPath), true);
      const manager = getConfigManager();
      const configPath = join(root, '.utcp_config.json');
      await manager.setConfigPath(configPath);
      await manager.ensureCocosEditorTemplate(port, relayInstanceId, auth.tokenPath);

      const configText = readFileSync(configPath, 'utf8');
      const config = JSON.parse(configText);
      const template = config.manual_call_templates.find((entry) => entry.name === `ccb3x_${port}`);
      assert.ok(template);
      assert.equal(template.url, `http://localhost:${port}/utcp`);
      assert.equal(template.headers['x-ccb-relay-instance'], '${CCB_RELAY_INSTANCE_ID}');
      assert.equal(template.headers['x-ccb-bound-port'], '${CCB_BOUND_PORT}');
      assert.equal(config.load_variables_from.length, 1);
      assert.deepEqual(config.load_variables_from[0], { variable_loader_type: 'dotenv', env_file_path: auth.tokenPath });
      assert.equal(configText.includes(auth.token), false);

      const tokenFile = readFileSync(auth.tokenPath, 'utf8');
      assert.match(tokenFile, new RegExp(`^CCB_RELAY_INSTANCE_ID=${relayInstanceId}$`, 'm'));
      assert.match(tokenFile, new RegExp(`^ccb3x__${port}_CCB_RELAY_INSTANCE_ID=${relayInstanceId}$`, 'm'));
      assert.match(tokenFile, new RegExp(`^ccb3x__${port}_CCB_LOCAL_TOKEN=${auth.token}$`, 'm'));
      assert.equal(loadOrCreateLocalAuth(relayInstanceId, join(root, 'auth')).token, auth.token);
    } finally {
      if (priorEditor === undefined) delete global.Editor;
      else global.Editor = priorEditor;
      console.log = priorLog;
      console.error = priorError;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
