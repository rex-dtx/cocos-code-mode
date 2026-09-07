'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

describe('UtcpServerManager stop', () => {
  it('waits for the HTTP server close callback before resolving', async () => {
    const { UtcpServerManager } = requireDist('utcp/utcp-server.js');
    const manager = new UtcpServerManager();
    let finishClose;
    let drained = false;
    manager.http = {
      beginDrain() {
        drained = true;
      },
      close() {
        assert.equal(drained, true);
        return new Promise((resolve) => {
          finishClose = resolve;
        });
      },
    };

    let settled = false;
    const stopping = Promise.resolve(manager.stop()).then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    finishClose();
    await stopping;
    assert.equal(manager.http, null);
    assert.equal(manager.port, 0);
  });

  it('exposes an explicit drain transition without closing immediately', () => {
    const { UtcpServerManager } = requireDist('utcp/utcp-server.js');
    const manager = new UtcpServerManager();
    let drains = 0;
    manager.http = { beginDrain() { drains += 1; } };
    manager.beginDrain();
    assert.equal(drains, 1);
  });
});
