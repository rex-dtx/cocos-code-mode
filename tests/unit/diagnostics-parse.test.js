'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { requireDist } = require('../helpers/require-dist');

const { parseTscOutput, createTscFailureDiagnostic } = requireDist('utcp/tools-2x/diagnostics-tools.js');

describe('parseTscOutput', () => {
  it('parses tsc pretty=false lines', () => {
    const project = process.platform === 'win32' ? 'C:/proj' : '/tmp/proj';
    const output = [
      'assets/Game.ts(12,5): error TS2322: Type \'string\' is not assignable to type \'number\'.',
      'src/util.ts(1,1): warning TS6133: unused.',
    ].join('\n');
    const diagnostics = parseTscOutput(output, project);
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[0].code, 'TS2322');
    assert.equal(diagnostics[0].line, 12);
    assert.equal(diagnostics[0].column, 5);
    assert.equal(diagnostics[0].file, path.resolve(project, 'assets/Game.ts'));
    assert.equal(diagnostics[1].code, 'TS6133');
  });

  it('wraps compiler crashes as a synthetic diagnostic', () => {
    const rows = createTscFailureDiagnostic('', 'npx tsc not found', '/tmp/tsconfig.json');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].code, 'TSCCMD');
    assert.match(rows[0].message, /npx tsc not found/);
  });
});
