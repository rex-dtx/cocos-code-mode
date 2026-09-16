'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

describe('live: runtime visual and input workflow', () => {
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

  it('captures, dispatches a safe key, and confirms bounded visual evidence remains valid', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }
    await repeatTestcase('RUNTIME-VISUAL-INPUT-01', async () => {
      const before = await postTool('runtimeScreenshotAssert', {
        windowTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
      });
      assert.equal(before.status, 200, JSON.stringify(before.body));
      assert.equal(before.body.passed, true);
      assert.equal(before.body.signatureValid, true);

      const dispatched = await postTool('runtimeInputDispatch', { action: 'key', key: 'Escape' });
      assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
      assert.equal(dispatched.body.success, true);

      const after = await postTool('runtimeScreenshotAssert', {
        windowTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
      });
      assert.equal(after.status, 200, JSON.stringify(after.body));
      assert.equal(after.body.passed, true);
      assert.equal(after.body.signatureValid, true);
      assert.match(after.body.sha256, /^[a-f0-9]{64}$/);
      assert.ok(after.body.bytes > 0);
    });
  });
});
