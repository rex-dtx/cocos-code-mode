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

describe('live: build target launch and smoke qualification', () => {
  let health;
  let projectPath;

  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const state = await getJson('/tools/editorState?timeoutMs=1000');
    assert.equal(state.status, 200, JSON.stringify(state.body));
    projectPath = state.body.projectPath;
  });

  it('launches the exact web artifact and verifies observable target content', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('BUILD-TARGET-01', async ({ iteration }) => {
      const relativePath = `temp/__ccb3x_build_target_${process.pid}_${iteration}__`;
      const absolutePath = path.join(projectPath, relativePath);
      const expected = `target-${process.pid}-${iteration}`;
      let serverId;
      let url;

      fs.mkdirSync(absolutePath, { recursive: true });
      fs.writeFileSync(path.join(absolutePath, 'index.html'), `<!doctype html><main>${expected}</main>`, 'utf8');

      try {
        const launched = await postTool('buildTargetLaunch', {
          artifactPath: relativePath,
          target: 'web-browser',
        });
        assert.equal(launched.status, 200, JSON.stringify(launched.body));
        assert.equal(launched.body.target, 'web-browser');
        assert.equal(launched.body.operation, 'start');
        assert.equal(launched.body.verified, true);
        assert.deepEqual(launched.body.lifecycle, ['started', 'verified']);
        serverId = launched.body.serverId;
        url = launched.body.url;

        const smoke = await postTool('buildTargetSmoke', { serverId, expectedText: expected });
        assert.equal(smoke.status, 200, JSON.stringify(smoke.body));
        assert.equal(smoke.body.serverId, serverId);
        assert.equal(smoke.body.url, url);
        assert.equal(smoke.body.statusCode, 200);
        assert.equal(smoke.body.contentMatched, true);
        assert.equal(smoke.body.passed, true);
        assert.ok(smoke.body.bytes > 0);

        const mismatch = await postTool('buildTargetSmoke', { serverId, expectedText: '__missing_content__' });
        assert.equal(mismatch.status, 200, JSON.stringify(mismatch.body));
        assert.equal(mismatch.body.statusCode, 200);
        assert.equal(mismatch.body.contentMatched, false);
        assert.equal(mismatch.body.passed, false);

        const unsupported = await postExpectedErrorTool('buildTargetLaunch', {
          artifactPath: relativePath,
          target: 'native-desktop',
        }, 'candidate.buildTargetLaunch.negative.v1');
        assert.equal(unsupported.status, 422, JSON.stringify(unsupported.body));
        assert.equal(unsupported.body.code, 'UNSUPPORTED_TARGET');

        const missing = await postExpectedErrorTool('buildTargetSmoke', {
          serverId: '__missing_target__',
        }, 'candidate.buildTargetSmoke.negative.v1');
        assert.equal(missing.status, 404, JSON.stringify(missing.body));
        assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
      } finally {
        if (serverId) {
          const stopped = await postTool('buildArtifactServe', { operation: 'stop', serverId });
          assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
          assert.equal(stopped.body.verified, true);
        }
        fs.rmSync(absolutePath, { recursive: true, force: true });
      }

      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
      assert.equal(fs.existsSync(absolutePath), false);
    });
  });
});
