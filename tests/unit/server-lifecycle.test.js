'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

describe('UtcpServerManager.stop', () => {
    it('waits for the listener close callback before resolving', async () => {
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
    });
});

describe('UtcpServerManager restart', () => {
    it('releases a bound port before a fresh manager listens on it', async () => {
        const { UtcpServerManager } = requireDist('utcp/utcp-server.js');
        const first = new UtcpServerManager();
        const port = await first.start(0);
        await first.stop();

        const second = new UtcpServerManager();
        assert.equal(await second.start(port), port);
        await second.stop();
    });
});
