'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getJson,
  postTool,
  postExpectedErrorTool,
  repeatTestcase,
  healthCheck,
} = require('../helpers/utcp-client');

describe('live: build artifact server qualification', () => {
  let health;
  let projectPath;

  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const state = await getJson('/tools/editorState?timeoutMs=1000');
    assert.equal(state.status, 200, JSON.stringify(state.body));
    projectPath = state.body.projectPath;
    assert.equal(typeof projectPath, 'string');
  });

  it('serves, verifies, stops, and rejects invalid web artifacts', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('BUILD-ARTIFACT-SERVE-01', async ({ iteration }) => {
      const relativePath = `temp/__ccb3x_artifact_qualification_${process.pid}_${iteration}__`;
      const absolutePath = path.join(projectPath, relativePath);
      const expected = `artifact-${process.pid}-${iteration}`;
      let serverId;
      let url;

      fs.mkdirSync(absolutePath, { recursive: true });
      fs.writeFileSync(path.join(absolutePath, 'index.html'), `<!doctype html><title>${expected}</title><main>${expected}</main>`, 'utf8');

      try {
        const started = await postTool('buildArtifactServe', { operation: 'start', artifactPath: relativePath });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal(started.body.operation, 'start');
        assert.equal(started.body.verified, true);
        assert.deepEqual(started.body.lifecycle, ['started', 'verified']);
        assert.match(started.body.serverId, /^artifact-[a-z0-9]+$/);
        assert.match(started.body.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
        serverId = started.body.serverId;
        url = started.body.url;

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        assert.match(await response.text(), new RegExp(expected));

        const traversal = await postExpectedErrorTool('buildArtifactServe', {
          operation: 'start',
          artifactPath: '../outside',
        }, 'candidate.buildArtifactServe.negative.v1');
        assert.equal(traversal.status, 400, JSON.stringify(traversal.body));
        assert.equal(traversal.body.code, 'INVALID_ARGUMENT');

        const missing = await postExpectedErrorTool('buildArtifactServe', {
          operation: 'start',
          artifactPath: `${relativePath}-missing`,
        }, 'candidate.buildArtifactServe.negative.v1');
        assert.equal(missing.status, 404, JSON.stringify(missing.body));
        assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
      } finally {
        if (serverId) {
          const stopped = await postTool('buildArtifactServe', { operation: 'stop', serverId });
          assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
          assert.equal(stopped.body.operation, 'stop');
          assert.equal(stopped.body.verified, true);
          assert.deepEqual(stopped.body.lifecycle, ['stopped']);
        }
        fs.rmSync(absolutePath, { recursive: true, force: true });
      }

      await assert.rejects(
        fetch(url, { signal: AbortSignal.timeout(1000) }),
        (error) => error && (error.name === 'TypeError' || error.name === 'TimeoutError'),
      );
      assert.equal(fs.existsSync(absolutePath), false);
    });
  });
});
