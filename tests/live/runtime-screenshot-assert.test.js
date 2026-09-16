'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: runtime screenshot assertion', () => {
  let health;
  let windowTitle;
  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const windows = await getJson('/tools/listEditorWindows');
    assert.equal(windows.status, 200, JSON.stringify(windows.body));
    const target = windows.body.windows.find((window) => /Cocos Creator/i.test(window.title));
    assert.ok(target, 'Creator main window unavailable');
    windowTitle = target.title;
  });

  it('asserts exact editor target screenshot identity and mismatch diagnostics', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('RUNTIME-SCREENSHOT-01', async () => {
      const first = await postTool('runtimeScreenshotAssert', {
        windowTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
      });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.signatureValid, true);
      assert.equal(first.body.matched, true);
      assert.equal(first.body.passed, true);
      assert.match(first.body.sha256, /^[a-f0-9]{64}$/);
      assert.ok(first.body.bytes > 0);

      const exact = await postTool('runtimeScreenshotAssert', {
        windowTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        expectedSha256: first.body.sha256,
      });
      assert.equal(exact.status, 200, JSON.stringify(exact.body));
      assert.equal(exact.body.passed, true);
      assert.equal(exact.body.matched, true);

      const mismatch = await postTool('runtimeScreenshotAssert', {
        windowTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        expectedSha256: first.body.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64),
      });
      assert.equal(mismatch.status, 200, JSON.stringify(mismatch.body));
      assert.equal(mismatch.body.passed, false);
      assert.equal(mismatch.body.matched, false);
      assert.deepEqual(mismatch.body.diagnostics, ['SHA256_MISMATCH']);
    });
  });
});
