'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('runtime contract schemas', () => {
  it('documents finite snapshot and screenshot bounds', () => {
    const snapshot = readSource('utcp/tools/scene-snapshot-tools.ts');
    const screenshot = readSource('utcp/tools/screenshot-tools.ts');

    assert.match(snapshot, /maxDepth: \{ type: 'integer', minimum: 0, maximum: MAX_SNAPSHOT_DEPTH/);
    assert.match(snapshot, /maxNodes: \{ type: 'integer', minimum: 1, maximum: MAX_SNAPSHOT_NODES/);
    assert.match(screenshot, /maximum: MAX_SCREENSHOT_DIMENSION/);
    assert.match(screenshot, /maximum \$\{MAX_SCREENSHOT_PIXELS\} pixels/);
    assert.match(screenshot, /jpegQuality: \{ type: 'integer', minimum: 0, maximum: 100/);
  });

  it('requires move destinations and bounds runtime time scale', () => {
    const arrayTools = readSource('utcp/tools/property-array-tools.ts');
    const runtime = readSource('utcp/tools/runtime-tools.ts');

    assert.match(arrayTools, /anyOf:\s*\[/);
    assert.match(arrayTools, /required: \['operation', 'toIndex'\]/);
    assert.match(runtime, /scale: \{ type: 'number', minimum: 0, maximum: 10/);
  });
});
