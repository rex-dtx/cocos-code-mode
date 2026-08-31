'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

const source = readSource('main.ts');

describe('extension startup status', () => {
    it('logs the live UTCP URL and reconnect guidance', () => {
        assert.match(source, /Ready: UTCP server listening at \$\{url\}/);
        assert.match(source, /New AI sessions discover ccb2x automatically; reconnect an existing Code Mode MCP session to refresh it\./);
    });
});

describe('open debug folder', () => {
    it('creates the debug directory before opening it', () => {
        assert.match(source, /mkdirSync\(DEBUG_LOG_DIR, \{ recursive: true \}\)/);
    });
});
