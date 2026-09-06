'use strict';
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { editorLogCandidates, pickExistingLog } = requireDist('utcp/tools-2x/editor-misc-tools.js');

describe('editorGetLogs — path candidates', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\me' : '/home/me';
  const project = process.platform === 'win32' ? 'C:\\proj' : '/tmp/proj';

  it('prefers session CocosCreator.log then project.log', () => {
    const paths = editorLogCandidates(project, home);
    assert.equal(paths[0], path.join(home, '.CocosCreator', 'logs', 'CocosCreator.log'));
    assert.equal(paths[1], path.join(project, 'temp', 'logs', 'project.log'));
  });

  it('picks the first existing file', () => {
    const paths = editorLogCandidates(project, home);
    const exists = (p) => p === paths[0];
    assert.equal(pickExistingLog(paths, exists), paths[0]);
  });

  it('falls back to project.log', () => {
    const paths = editorLogCandidates(project, home);
    const exists = (p) => p === paths[1];
    assert.equal(pickExistingLog(paths, exists), paths[1]);
  });

  it('returns null when nothing exists', () => {
    assert.equal(pickExistingLog(editorLogCandidates(project, home), () => false), null);
  });
});
