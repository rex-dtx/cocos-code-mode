'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { healthCheck } = require('../helpers/utcp-client');

describe('utcp-client healthCheck', () => {
  it('returns ok:false when no editor is listening', async () => {
    process.env.UTCP_BASE = 'http://127.0.0.1:1';
    delete require.cache[require.resolve('../helpers/utcp-client')];
    const { healthCheck: check } = require('../helpers/utcp-client');
    const h = await check();
    assert.equal(h.ok, false);
    assert.ok(h.reason);
    delete process.env.UTCP_BASE;
  });
});
