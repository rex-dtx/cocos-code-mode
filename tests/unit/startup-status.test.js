'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('extension startup status', () => {
  it('logs a concise ready message with the live UTCP URL and usage guidance', () => {
    const source = readSource('main.ts');
    assert.match(source, /Ready: UTCP server listening at \$\{url\}/);
    assert.match(source, /New AI sessions discover ccb3x automatically; reconnect an existing Code Mode MCP session to refresh it\./);
    assert.match(source, /===========Loaded cc-bridge-3x===========/);
  });
});
