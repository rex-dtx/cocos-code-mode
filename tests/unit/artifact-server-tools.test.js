'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { ArtifactServerTools, closeArtifactServers } = requireDist('utcp/tools/artifact-server-tools.js');
const projects = [];

afterEach(() => {
  closeArtifactServers();
  delete global.Editor;
  for (const project of projects.splice(0)) fs.rmSync(project, { recursive: true, force: true });
});

function makeArtifact() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-artifact-server-'));
  projects.push(project);
  const relativePath = 'build/web-desktop';
  const artifact = path.join(project, relativePath);
  fs.mkdirSync(artifact, { recursive: true });
  fs.writeFileSync(path.join(artifact, 'index.html'), '<main>qualified artifact</main>', 'utf8');
  global.Editor = { Project: { path: project } };
  return { relativePath };
}

describe('artifact target launch and smoke tools', () => {
  it('launches, smokes, and stops the exact served web artifact', async () => {
    const { relativePath } = makeArtifact();
    const tools = new ArtifactServerTools();

    const launched = await tools.buildTargetLaunch({ artifactPath: relativePath, target: 'web-browser' });
    assert.equal(launched.target, 'web-browser');
    assert.equal(launched.verified, true);
    assert.deepEqual(launched.lifecycle, ['started', 'verified']);

    const smoke = await tools.buildTargetSmoke({ serverId: launched.serverId, expectedText: 'qualified artifact' });
    assert.equal(smoke.passed, true);
    assert.equal(smoke.statusCode, 200);
    assert.equal(smoke.contentMatched, true);
    assert.ok(smoke.bytes > 0);

    const stopped = await tools.buildArtifactServe({ operation: 'stop', serverId: launched.serverId });
    assert.deepEqual(stopped.lifecycle, ['stopped']);
  });

  it('rejects unsupported targets and fails smoke on missing content', async () => {
    const { relativePath } = makeArtifact();
    const tools = new ArtifactServerTools();

    await assert.rejects(
      tools.buildTargetLaunch({ artifactPath: relativePath, target: 'native-desktop' }),
      (error) => error.code === 'UNSUPPORTED_TARGET' && error.status === 422,
    );

    const launched = await tools.buildTargetLaunch({ artifactPath: relativePath, target: 'web-browser' });
    try {
      const smoke = await tools.buildTargetSmoke({ serverId: launched.serverId, expectedText: '__missing_text__' });
      assert.equal(smoke.passed, false);
      assert.equal(smoke.statusCode, 200);
      assert.equal(smoke.contentMatched, false);
    } finally {
      await tools.buildArtifactServe({ operation: 'stop', serverId: launched.serverId });
    }

    await assert.rejects(
      tools.buildTargetSmoke({ serverId: '__missing_server__' }),
      (error) => error.code === 'TARGET_NOT_FOUND' && error.status === 404,
    );
  });
});
