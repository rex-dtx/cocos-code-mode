'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const template = fs.readFileSync(path.join(root, 'static/template/configuration/index.html'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'source/panels/configuration/index.ts'), 'utf8');

describe('configuration guidance', () => {
  it('identifies the MCP server as Cocos Pilot and exposes an agent instruction', () => {
    assert.match(template, /Cocos Pilot/);
    assert.match(template, /id="agent-instruction"/);
    assert.match(template, /MCP configuration/i);
    assert.match(panel, /['"]cc-pilot['"]/);
    assert.doesNotMatch(panel, /['"]cocos-pilot['"]/);
    assert.doesNotMatch(panel, /['"]code-mode['"]/);
  });
});
