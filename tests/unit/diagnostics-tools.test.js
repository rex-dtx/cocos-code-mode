'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

describe('TypeScript diagnostics failures', () => {
  it('returns an actionable diagnostic when tsc emits no parseable file error', () => {
    const { createTscFailureDiagnostic } = requireDist('utcp/tools/diagnostics-tools.js');
    const [diagnostic] = createTscFailureDiagnostic('', 'npx tsc exited with code 1', 'C:/project/tsconfig.json');

    assert.equal(diagnostic.file, 'C:/project/tsconfig.json');
    assert.equal(diagnostic.code, 'TSCCMD');
    assert.equal(diagnostic.message, 'npx tsc exited with code 1');
  });
});
