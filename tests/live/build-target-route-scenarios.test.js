'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getJson,
  postTool,
  repeatTestcase,
  healthCheck,
  fetchTargetUrl,
} = require('../helpers/utcp-client');
describe('live: build target HTTP route scenarios', () => {
  let health;
  let projectPath;
  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const state = await getJson('/tools/editorState?timeoutMs=1000');
    assert.equal(state.status, 200, JSON.stringify(state.body));
    projectPath = state.body.projectPath;
  });

  it('serves nested files and reports route-level missing and traversal outcomes', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('BUILD-TARGET-E01', async ({ iteration }) => {
      const relativePath = `temp/__ccp3x_route_${process.pid}_${iteration}__`;
      const root = path.join(projectPath, relativePath);
      const expected = `route-${process.pid}-${iteration}`;
      let serverId;
      try {
        fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(root, 'index.html'), `<main>${expected}</main>`, 'utf8');
        fs.writeFileSync(path.join(root, 'nested', 'data.txt'), expected, 'utf8');
        const launched = await postTool('buildTargetLaunch', { artifactPath: relativePath, target: 'web-browser' });
        assert.equal(launched.status, 200, JSON.stringify(launched.body));
        serverId = launched.body.serverId;
        const base = launched.body.url;

        const nested = await fetchTargetUrl(new URL('nested/data.txt', base).toString());
        assert.equal(nested.status, 200);
        assert.equal(await nested.text(), expected);

        const missing = await fetchTargetUrl(new URL('missing.txt', base).toString());
        assert.equal(missing.status, 404);

        const traversal = await fetchTargetUrl(new URL('%2e%2e/package.json', base).toString());
        assert.ok([403, 404].includes(traversal.status));
      } finally {
        if (serverId) {
          const stopped = await postTool('buildArtifactServe', { operation: 'stop', serverId });
          assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
      assert.equal(fs.existsSync(root), false);
    });
  });
});
