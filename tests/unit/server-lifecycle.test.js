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
