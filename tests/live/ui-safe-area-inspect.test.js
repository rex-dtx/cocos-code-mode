'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: uiSafeAreaInspect', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('witnesses inside and outside safe-area geometry plus typed failures', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const manual = await getJson('/utcp');
    assert.equal(manual.ok, true, JSON.stringify(manual.body));
    assert.ok(manual.body.tools.some((item) => item.name === 'uiSafeAreaInspect'));

    const rootResult = await postTool('createUiNode', { uiType: 'Widget', name: '__ccb3x_safe_area_root__' });
    assert.equal(rootResult.ok, true, JSON.stringify(rootResult.body));
    const root = rootResult.body.reference;
    let inside;
    let outside;
    try {
      const insideResult = await postTool('createUiNode', { uiType: 'Widget', name: '__ccb3x_safe_area_inside__', parentReference: root });
      const outsideResult = await postTool('createUiNode', { uiType: 'Widget', name: '__ccb3x_safe_area_outside__', parentReference: root });
      assert.equal(insideResult.ok, true, JSON.stringify(insideResult.body));
      assert.equal(outsideResult.ok, true, JSON.stringify(outsideResult.body));
      inside = insideResult.body.reference;
      outside = outsideResult.body.reference;
      for (const [reference, size, position] of [
        [root, { width: 100, height: 100 }, { x: 0, y: 0, z: 0 }],
        [inside, { width: 20, height: 20 }, { x: 10, y: 10, z: 0 }],
        [outside, { width: 20, height: 20 }, { x: 100, y: 100, z: 0 }],
      ]) {
        const sized = await postTool('uiLayoutApply', { reference, size, position });
        assert.equal(sized.ok, true, JSON.stringify(sized.body));
      }

      const report = await postTool('uiSafeAreaInspect', {
        root,
        safeArea: { rect: { x: 0, y: 0, width: 100, height: 100 } },
        maxNodes: 8,
        maxIssues: 8,
      });
      assert.equal(report.ok, true, JSON.stringify(report.body));
      assert.equal(report.body.complete, true);
      assert.equal(report.body.valid, false);
      assert.equal(report.body.nodes.find((item) => item.uuid === inside.id).inside, true);
      assert.equal(report.body.nodes.find((item) => item.uuid === outside.id).outside, true);
      assert.ok(report.body.issues.some((item) => item.nodeId === outside.id));

      const invalid = await postTool('uiSafeAreaInspect', {
        root,
        safeArea: { rect: { x: 0, y: 0, width: 0, height: 100 } },
      });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));

      const missing = await postTool('uiSafeAreaInspect', {
        root: { id: '__ccb3x_missing_safe_area__', type: 'cc.Node' },
        safeArea: { rect: { x: 0, y: 0, width: 100, height: 100 } },
      });
      assert.equal(missing.ok, true, JSON.stringify(missing.body));
      assert.equal(missing.body.error.code, 'UI_SAFE_AREA_ROOT_NOT_FOUND');
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference: root });
    }
  });
});
