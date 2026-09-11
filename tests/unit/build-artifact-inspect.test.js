'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const fsExtra = require('fs-extra');


const { ExpansionTools } = requireDist('utcp/tools/expansion-tools.js');
const tempProjects = [];

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-artifact-inspect-'));
  tempProjects.push(project);
  return project;
}

afterEach(() => {
  delete global.Editor;
  for (const project of tempProjects.splice(0)) fs.rmSync(project, { recursive: true, force: true });
});

describe('buildArtifactInspect', () => {
  it('returns lexical, bounded files and an exact truncation signal', async () => {
    const project = makeProject();
    fs.mkdirSync(path.join(project, 'z'), { recursive: true });
    fs.writeFileSync(path.join(project, 'z', 'b.txt'), 'two');
    fs.writeFileSync(path.join(project, 'z', 'a.txt'), 'one');
    fs.writeFileSync(path.join(project, 'a.txt'), 'a');
    global.Editor = { Project: { path: project } };

    const result = await new ExpansionTools().buildArtifactInspect({ artifactPath: '.', maxFiles: 2 });
    assert.deepEqual(result, {
      exists: true,
      files: [
        { path: 'a.txt', bytes: 1 },
        { path: 'z/a.txt', bytes: 3 },
      ],
      count: 2,
      truncated: true,
    });
  });

  it('orders files by their full lexical project-relative path, not directory DFS order', async () => {
    const project = makeProject();
    fs.mkdirSync(path.join(project, 'a'));
    fs.writeFileSync(path.join(project, 'a', 'file.txt'), 'nested');
    fs.writeFileSync(path.join(project, 'a.txt'), 'sibling');
    global.Editor = { Project: { path: project } };

    const result = await new ExpansionTools().buildArtifactInspect({ artifactPath: '.', maxFiles: 2 });
    assert.deepEqual(result.files.map((file) => file.path), ['a.txt', 'a/file.txt']);
    assert.equal(result.truncated, false);
  });

  it('does not mark truncation when remaining entries contain only empty or cyclic directories', async (t) => {
    const project = makeProject();
    fs.writeFileSync(path.join(project, 'a.txt'), 'a');
    fs.mkdirSync(path.join(project, 'empty'));
    try {
      fs.symlinkSync(path.join(project, 'empty'), path.join(project, 'empty', 'loop'), 'junction');
    } catch (error) {
      t.diagnostic(`cycle symlink unavailable: ${error.message}`);
    }
    global.Editor = { Project: { path: project } };

    const result = await new ExpansionTools().buildArtifactInspect({ artifactPath: '.', maxFiles: 1 });
    assert.deepEqual(result.files, [{ path: 'a.txt', bytes: 1 }]);
    assert.equal(result.truncated, false);
  });


  it('reports missing paths without filesystem false-success or fabricated files', async () => {
    const project = makeProject();
    global.Editor = { Project: { path: project } };

    const result = await new ExpansionTools().buildArtifactInspect({ artifactPath: 'build/web-mobile' });
    assert.deepEqual(result, { exists: false, files: [], count: 0, truncated: false });
  });

  it('rejects empty, absolute, traversal, control-character, and malformed bounds as typed 400 errors', async () => {
    const project = makeProject();
    global.Editor = { Project: { path: project } };
    const tool = new ExpansionTools();
    for (const args of [
      { artifactPath: '' },
      { artifactPath: 'nested/../outside' },
      { artifactPath: 'C:relative' },
      { artifactPath: 'bad\nname' },
      { artifactPath: 'build', maxFiles: 0 },
      { artifactPath: 'build', maxFiles: 257 },
      { artifactPath: 'build', maxFiles: 1.5 },
      { artifactPath: 'build', maxFiles: '2' },
    ]) {
      await assert.rejects(tool.buildArtifactInspect(args), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    }
  });

  it('rejects symlink targets that resolve outside the project', async (t) => {
    const project = makeProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-artifact-outside-'));
    tempProjects.push(outside);
    fs.writeFileSync(path.join(outside, 'secret.bin'), 'secret');
    try {
      fs.symlinkSync(outside, path.join(project, 'escape'), 'junction');
    } catch (error) {
      t.skip(`symlink creation unavailable: ${error.message}`);
      return;
    }
    global.Editor = { Project: { path: project } };
    await assert.rejects(
      new ExpansionTools().buildArtifactInspect({ artifactPath: 'escape' }),
      (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });
  it('wraps permission and other filesystem failures as typed 502 errors', async () => {
    const project = makeProject();
    global.Editor = { Project: { path: project } };
    const originalRealpath = fsExtra.realpath;
    fsExtra.realpath = async () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    };
    try {
      await assert.rejects(
        new ExpansionTools().buildArtifactInspect({ artifactPath: 'build' }),
        (error) => error.code === 'BUILD_ARTIFACT_INSPECT_FAILED' && error.status === 502,
      );
    } finally {
      fsExtra.realpath = originalRealpath;
    }
  });
});

