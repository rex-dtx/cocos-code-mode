'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readSource } = require('../helpers/require-dist');

describe('editorEnvInfo', () => {
  it('uses the supported Creator engine information message', () => {
    const source = readSource('utcp/tools/editor-tools.ts');
    assert.match(source, /Editor\.Message\.request\('engine', 'query-engine-info'\)/);
    assert.match(source, /const version = Editor\.App\.version/);
    assert.match(source, /enginePath: info\.typescript\.path/);
    assert.match(source, /nativePath: info\.native\.path/);
  });
});
