'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('wave 3 portable parity tools', () => {
  it('animationQuery exposes the 10 operations', () => {
    const source = readSource('utcp/tools-2x/animation-tools.ts');
    assert.match(source, /'root_info'/);
    assert.match(source, /'value_at_frame'/);
    assert.match(source, /'clip_time'/);
    assert.match(source, /'animation-query'/);
  });

  it('registers findNodesByAsset, prefab JSON, array, events, validation', () => {
    const read = readSource('utcp/tools-2x/scene-read-tools.ts');
    const prefab = readSource('utcp/tools-2x/prefab-json-tools.ts');
    const arr = readSource('utcp/tools-2x/property-array-tools.ts');
    const ev = readSource('utcp/tools-2x/event-tools.ts');
    const val = readSource('utcp/tools-2x/validation-tools.ts');
    assert.match(read, /@utcpTool\(\s*'findNodesByAsset'/);
    assert.match(prefab, /@utcpTool\(\s*'readPrefabJson'/);
    assert.match(prefab, /@utcpTool\(\s*'editPrefabJson'/);
    assert.match(prefab, /@utcpTool\(\s*'duplicatePrefab'/);
    assert.match(arr, /@utcpTool\(\s*'propertyArrayElement'/);
    assert.match(ev, /@utcpTool\(\s*'simulateButtonClick'/);
    assert.match(ev, /@utcpTool\(\s*'bindButtonClickEvent'/);
    assert.match(val, /@utcpTool\(\s*'getPerformanceSnapshot'/);
    assert.match(val, /@utcpTool\(\s*'validateScene'/);
  });

  it('scene-script hosts animation/array/button/perf handlers', () => {
    const source = readSource('scene-script.ts');
    assert.match(source, /'animation-query'/);
    assert.match(source, /'array-element'/);
    assert.match(source, /'simulate-button-click'/);
    assert.match(source, /'bind-button-click'/);
    assert.match(source, /'scene-perf'/);
  });
});
