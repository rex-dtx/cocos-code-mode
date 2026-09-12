'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('uiFocusNavigation', () => {
  it('declares a finite strict read-only contract and public scene query route', () => {
    const source = readSource('utcp/tools/ui-tools.ts');
    const start = source.indexOf("'uiFocusNavigation'");
    const end = source.indexOf("'uiLayoutAlign'", start);
    assert.ok(start >= 0 && end > start);
    const contract = source.slice(start, end);
    assert.match(contract, /additionalProperties: false/);
    assert.match(contract, /maxItems: 100/);
    assert.match(contract, /'GET'/);
    assert.match(contract, /queryNodeDump/);
    assert.doesNotMatch(contract, /set-property|snapshot|executeJavascript|runCode/);
  });

  it('rejects invalid input before querying or mutating the scene', () => {
    const source = readSource('utcp/tools/ui-tools.ts');
    const start = source.indexOf("async uiFocusNavigation");
    const end = source.indexOf("@utcpTool", start);
    const body = source.slice(start, end < 0 ? source.length : end);
    assert.match(body, /references must contain 1 to 100 nodes/);
    assert.match(body, /unique non-empty node UUIDs/);
    assert.match(body, /INVALID_ARGUMENT/);
    assert.doesNotMatch(body, /set-property|snapshot/);
  });
});
