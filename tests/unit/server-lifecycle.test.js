'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

describe('UtcpServerManager stop', () => {
  it('waits for the HTTP server close callback before resolving', async () => {
    const { UtcpServerManager } = requireDist('utcp/utcp-server.js');
    const manager = new UtcpServerManager();
    let finishClose;
    manager.server = {
      close(callback) {
        finishClose = callback;
      },
    };

    let settled = false;
    const stopping = Promise.resolve(manager.stop()).then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    finishClose();
    await stopping;
    assert.equal(manager.server, null);
    assert.equal(manager.port, 0);
  });
});

it('allocates independent ports and rejects a fixed collision without fallback', async () => {
  const { UtcpServerManager } = requireDist('utcp/utcp-server.js');
  const first = new UtcpServerManager();
  const second = new UtcpServerManager();
  const collision = new UtcpServerManager();
  try {
    const [firstPort, secondPort] = await Promise.all([first.start(), second.start()]);
    assert.notEqual(firstPort, secondPort);
    assert.notEqual(first.instanceId, second.instanceId);
    await assert.rejects(collision.start(firstPort), { code: 'EADDRINUSE' });
    assert.equal(collision.port, 0);
    await assert.rejects(first.start(), /already started/);
    assert.equal((await fetch(`http://127.0.0.1:${firstPort}/utcp`)).status, 200);
  } finally {
    await Promise.all([first.stop(), second.stop(), collision.stop()]);
  }
});

it('keeps invalid restarts running and closes unpublished endpoints', async () => {
  const original = global.Editor;
  const preferences = new Map([['serverPort', 49650]]);
  const writes = [];
  global.Editor = {
    Project: { path: process.cwd() },
    Profile: {
      getConfig: async (_package, key) => preferences.get(key),
      setConfig: async (_package, key, value) => { preferences.set(key, value); writes.push([key, value]); },
    },
    Message: { request: async () => true },
  };
  const config = requireDist('utcp/config-manager.js').getConfigManager();
  const originalUpdate = config.updatePort;
  const originalRemove = config.removeCocosEditorTemplate;
  const published = [];
  const removed = [];
  let failPublication = false;
  config.updatePort = async (port, instanceId) => {
    published.push({ port, instanceId });
    if (failPublication) throw new Error('registry unavailable');
  };
  config.removeCocosEditorTemplate = async (port, instanceId, configPath) => {
    removed.push({ port, instanceId, configPath });
    return true;
  };
  const main = requireDist('main.js');
  const handshake = async port => (await fetch(`http://127.0.0.1:${port}/tools/editorHandshake`)).json();
  try {
    await main.load();
    const first = published[0];
    const configPath = config.getConfigPath();
    assert.equal((await handshake(first.port)).instanceId, first.instanceId);
    assert.deepEqual(writes, [], 'auto allocation must not persist the actual port');
    await assert.rejects(main.methods.restartServer(-1), /Port must/);
    assert.equal((await handshake(first.port)).instanceId, first.instanceId);
    assert.equal(removed.length, 0);
    failPublication = true;
    await assert.rejects(main.methods.restartServer(0), /registry unavailable/);
    const failed = published[1];
    assert.deepEqual(writes, [['fixedServerPort', 0]]);
    assert.deepEqual(removed, [{ ...first, configPath }, { ...failed, configPath }]);
    await assert.rejects(fetch(`http://127.0.0.1:${failed.port}/utcp`));
    failPublication = false;
    await main.methods.restartServer();
    const recovered = published[2];
    assert.equal((await handshake(recovered.port)).instanceId, recovered.instanceId);
    await main.unload();
    assert.deepEqual(removed[2], { ...recovered, configPath });
    await assert.rejects(fetch(`http://127.0.0.1:${recovered.port}/utcp`));
  } finally {
    await main.unload();
    config.updatePort = originalUpdate;
    config.removeCocosEditorTemplate = originalRemove;
    global.Editor = original;
  }
});
