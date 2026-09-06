'use strict';
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { resolveInstructionPath } = requireDist('utcp/tools-2x/instruction-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

describe('instruction-tools — resolveInstructionPath', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/tmp/proj';

  it('resolves a project-relative instruction file', () => {
    const resolved = resolveInstructionPath(root, 'AGENTS.md');
    assert.equal(resolved, path.resolve(root, 'AGENTS.md'));
  });

  it('resolves nested rules paths', () => {
    const resolved = resolveInstructionPath(root, 'docs/rules/foo.md');
    assert.equal(resolved, path.resolve(root, 'docs/rules/foo.md'));
  });

  it('throws PATH_ESCAPES_PROJECT on parent traversal', () => {
    assert.throws(
      () => resolveInstructionPath(root, '../secret.md'),
      (err) => err instanceof ToolError && err.code === 'PATH_ESCAPES_PROJECT' && err.status === 400
    );
  });

  it('throws PATH_ESCAPES_PROJECT on absolute outside path', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\hosts' : '/etc/hosts';
    assert.throws(
      () => resolveInstructionPath(root, outside),
      (err) => err instanceof ToolError && err.code === 'PATH_ESCAPES_PROJECT'
    );
  });
});
