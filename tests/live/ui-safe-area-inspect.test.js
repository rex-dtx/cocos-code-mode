'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, getJson, repeatTestcase, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

describe('live: uiSafeAreaInspect', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('witnesses inside and outside safe-area geometry plus typed failures', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const manual = await getJson('/utcp');
    assert.equal(manual.ok, true, JSON.stringify(manual.body));
    assert.ok(manual.body.tools.some((item) => item.name === 'uiSafeAreaInspect'));

    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    await repeatTestcase('UI-SAFEAREA-I01', async () => {
      const rootResult = await postTool('createUiNode', { uiType: 'Label', parentReference: canvas, name: `__ccp3x_safe_area_root_${Date.now()}__` });
      assert.equal(rootResult.ok, true, JSON.stringify(rootResult.body));
      const root = rootResult.body.reference;
      let inside;
      let outside;
      try {
        const insideResult = await postTool('createUiNode', { uiType: 'Label', name: '__ccp3x_safe_area_inside__', parentReference: root });
        const outsideResult = await postTool('createUiNode', { uiType: 'Label', name: '__ccp3x_safe_area_outside__', parentReference: root });
        assert.equal(insideResult.ok, true, JSON.stringify(insideResult.body));
        assert.equal(outsideResult.ok, true, JSON.stringify(outsideResult.body));
        inside = insideResult.body.reference;
        outside = outsideResult.body.reference;
        for (const [reference, size, position] of [[root, { width: 100, height: 100 }, { x: 0, y: 0, z: 0 }], [inside, { width: 20, height: 20 }, { x: 10, y: 10, z: 0 }], [outside, { width: 20, height: 20 }, { x: 100, y: 100, z: 0 }]]) {
          const sized = await postTool('uiLayoutApply', { reference, size, position });
          assert.equal(sized.ok, true, JSON.stringify(sized.body));
        }
        const report = await postTool('uiSafeAreaInspect', { root, safeArea: { rect: { x: 640, y: 360, width: 100, height: 100 } }, maxNodes: 8, maxIssues: 8 });
        if (!report.ok && report.status === 500 && report.body?.code === 'INTERNAL_ERROR') return { status: 'SKIP', reason: 'Creator rejected safe-area geometry fixture' };
        assert.equal(report.ok, true, JSON.stringify(report.body));
        assert.equal(report.body.complete, true);
        assert.equal(report.body.valid, false);
        const insideNode = report.body.nodes.find((item) => item.uuid === inside.id);
        const outsideNode = report.body.nodes.find((item) => item.uuid === outside.id);
        assert.ok(insideNode && outsideNode);
        assert.ok(insideNode.inside === true || insideNode.outside === true);
        assert.ok(outsideNode.inside === true || outsideNode.outside === true);
        assert.ok(report.body.issues.some((item) => item.nodeId === outside.id || item.nodeId === inside.id));
        const invalid = await postTool('uiSafeAreaInspect', { root, safeArea: { rect: { x: 0, y: 0, width: 0, height: 100 } } });
        assert.equal(invalid.ok, true, JSON.stringify(invalid.body));
        assert.equal(invalid.body.error.code, 'UI_SAFE_AREA_INVALID_INPUT');
        const missing = await postTool('uiSafeAreaInspect', { root: { id: '__ccp3x_missing_safe_area__', type: 'cc.Node' }, safeArea: { rect: { x: 0, y: 0, width: 100, height: 100 } } });
        assert.equal(missing.ok, true, JSON.stringify(missing.body));
        assert.equal(missing.body.error.code, 'UI_SAFE_AREA_ROOT_NOT_FOUND');
      } finally {
        await postTool('nodeOperate', { operation: 'delete', reference: root });
      }
    });
  });
});
