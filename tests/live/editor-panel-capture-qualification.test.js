'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  getJson,
  postTool,
  postExpectedErrorTool,
  repeatTestcase,
  healthCheck,
} = require('../helpers/utcp-client');

describe('live: editor panel capture qualification', () => {
  let health;
  let panelTitle;

  before(async () => {
    health = await healthCheck();
    if (!health?.ok) return;
    const windows = await getJson('/tools/listEditorWindows');
    assert.equal(windows.status, 200, JSON.stringify(windows.body));
    const candidate = windows.body.windows.find((window) => /Cocos Creator/i.test(window.title))
      || windows.body.windows.find((window) => window.title && !/DevTools/i.test(window.title));
    assert.ok(candidate, 'Creator exposed no capturable editor window');
    panelTitle = candidate.title;
  });

  it('captures bounded PNG content and rejects missing or invalid targets', { timeout: 120_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('EDITOR-PANEL-CAPTURE-01', async () => {
      const captured = await postTool('editorPanelCapture', {
        panelTitle,
        bounds: { x: 0, y: 0, width: 64, height: 64 },
      });
      assert.equal(captured.status, 200, JSON.stringify(captured.body));
      assert.equal(captured.body.panelTitle, panelTitle);
      assert.deepEqual(captured.body.bounds, { x: 0, y: 0, width: 64, height: 64 });
      assert.equal(captured.body.type, 'image');
      assert.equal(captured.body.mimeType, 'image/png');
      assert.match(captured.body.data, /^iVBORw0KGgo/);
      assert.ok(captured.body.data.length > 100);

      const missing = await postExpectedErrorTool('editorPanelCapture', {
        panelTitle: '__ccp3x_missing_panel__',
        bounds: { x: 0, y: 0, width: 64, height: 64 },
      }, 'candidate.editorPanelCapture.negative.v1');
      assert.equal(missing.status, 500, JSON.stringify(missing.body));
      assert.equal(missing.body.code, 'INTERNAL_ERROR');

      const invalid = await postExpectedErrorTool('editorPanelCapture', {
        panelTitle,
        bounds: { x: 0, y: 0, width: 0, height: 64 },
      }, 'candidate.editorPanelCapture.negative.v1');
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    });
  });
});
