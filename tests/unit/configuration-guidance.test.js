'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(root, 'static/template/configuration/index.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'panel/configuration.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'source/main.ts'), 'utf8');

describe('configuration guidance', () => {
  it('identifies the MCP server as CC Bridge and exposes an agent instruction', () => {
    assert.match(template, /CC Bridge MCP Integration/);
    assert.match(template, /id="agent-instruction-code"/);
    assert.match(panel, /Discover first, then act/);
    assert.match(panel, /"cc-bridge"|'cc-bridge'/);
    assert.doesNotMatch(panel, /"code-mode":/);
  });

  it('uses Creator 2.4 widgets and this.$name element access', () => {
    assert.match(template, /<ui-text-area/);
    assert.match(template, /<ui-num-input id="port-input"/);
    assert.match(template, /<ui-input id="utcp-config-path"/);
    assert.doesNotMatch(template, /<ui-code/);
    assert.doesNotMatch(template, /<ui-textarea/);
    assert.match(panel, /panel\['\$' \+ key\]/);
    assert.match(panel, /clipboard\.writeText/);
    assert.match(main, /'query-status'/);
  });

  it('exposes copy buttons for port, URL, path, MCP config, instruction, and templates', () => {
    assert.match(template, /id="copy-port-btn"/);
    assert.match(template, /id="copy-url-btn"/);
    assert.match(template, /id="copy-path-btn"/);
    assert.match(template, /id="copy-mcp-btn"/);
    assert.match(template, /id="copy-instruction-btn"/);
    assert.match(panel, /copy-json-btn/);
    assert.match(panel, /copy-tpl-url-btn/);
  });
});
