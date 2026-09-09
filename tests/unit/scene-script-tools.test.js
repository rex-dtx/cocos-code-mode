'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source() {
  return fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/scene-tools.ts'), 'utf8');
}

describe('scene script health tools', () => {
  it('exposes a bounded read-only scan using scene tree and registered classes', () => {
    const src = source();
    assert.match(src, /'sceneScriptHealthScan'/);
    assert.match(src, /Editor\.Message\.request\('scene', 'query-node-tree'/);
    assert.match(src, /Editor\.Message\.request\('scene', 'query-components'/);
    assert.match(src, /truncated: findings\.length > limit/);
    assert.match(src, /repair: 'Provide scriptReference or replacementClassId/);
  });

  it('guards repair, uses the narrow editor component APIs, and verifies creation', () => {
    const src = source();
    assert.match(src, /'sceneScriptRepair'/);
    assert.match(src, /query-node/);
    assert.match(src, /query-script-cid/);
    assert.match(src, /replacement class .*not registered/);
    assert.match(src, /'scene', 'remove-component'/);
    assert.match(src, /'scene', 'create-component'/);
    assert.match(src, /'scene', 'snapshot'/);
    assert.match(src, /replacement was not found after create-component/);
  });
});
