'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { requireDist } = require('../helpers/require-dist');
const { ScreenshotTools } = requireDist('utcp/tools/screenshot-tools.js');

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('runtimeScreenshotAssert', () => {
  it('returns exact hash evidence and deterministic mismatch diagnostics', async () => {
    const tools = new ScreenshotTools();
    tools.editorPanelCapture = async ({ panelTitle, bounds }) => ({ panelTitle, bounds, type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' });
    const expectedSha256 = createHash('sha256').update(PNG).digest('hex');

    const matched = await tools.runtimeScreenshotAssert({ windowTitle: 'Creator', bounds: { x: 0, y: 0, width: 8, height: 8 }, expectedSha256 });
    assert.equal(matched.passed, true);
    assert.equal(matched.signatureValid, true);
    assert.equal(matched.matched, true);
    assert.deepEqual(matched.diagnostics, []);

    const mismatch = await tools.runtimeScreenshotAssert({ windowTitle: 'Creator', bounds: { x: 0, y: 0, width: 8, height: 8 }, expectedSha256: '0'.repeat(64) });
    assert.equal(mismatch.passed, false);
    assert.equal(mismatch.matched, false);
    assert.deepEqual(mismatch.diagnostics, ['SHA256_MISMATCH']);
  });

  it('falls back to full-window capture when bounded panel capture is unavailable', async () => {
    const tools = new ScreenshotTools();
    tools.editorPanelCapture = async () => { throw new Error('capturePage unavailable'); };
    tools.captureEditorScreenshot = async () => ({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' });
    const result = await tools.runtimeScreenshotAssert({ windowTitle: 'Creator', bounds: { x: 0, y: 0, width: 8, height: 8 } });
    assert.equal(result.passed, true);
    assert.equal(result.signatureValid, true);
  });
});
