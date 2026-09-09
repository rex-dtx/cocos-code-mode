'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: uiLayoutReport', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('reports live UI geometry, inactive inventory, invalid roots, truncation, and overlay lifecycle', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const manual = await getJson('/utcp');
    assert.equal(manual.ok, true, JSON.stringify(manual.body));
    const tool = manual.body.tools.find((item) => item.name === 'uiLayoutReport');
    assert.ok(tool, 'uiLayoutReport must be discoverable');
    assert.equal(Object.prototype.hasOwnProperty.call(tool, 'annotations'), false);

    const rootResult = await postTool('createUiNode', { uiType: 'Widget', name: '__ccb3x_layout_report_root__' });
    assert.equal(rootResult.ok, true, JSON.stringify(rootResult.body));
    const root = rootResult.body.reference;
    let child;
    try {
      const childResult = await postTool('createUiNode', { uiType: 'Label', name: '__ccb3x_layout_report_child__', parentReference: root });
      assert.equal(childResult.ok, true, JSON.stringify(childResult.body));
      child = childResult.body.reference;
      const rootTransform = await postTool('inspectorSet', { target: 'instance', reference: root, propertyPath: 'scale', value: { x: 1.5, y: 0.75, z: 1 } });
      assert.equal(rootTransform.ok, true, JSON.stringify(rootTransform.body));
      const childTransform = await postTool('inspectorSet', { target: 'instance', reference: child, propertyPath: 'position', value: { x: 30, y: 20, z: 0 } });
      assert.equal(childTransform.ok, true, JSON.stringify(childTransform.body));
      const childRotation = await postTool('inspectorSet', { target: 'instance', reference: child, propertyPath: 'rotation', value: { x: 0, y: 0, z: 0.21644, w: 0.976296 } });
      assert.equal(childRotation.ok, true, JSON.stringify(childRotation.body));

      const report = await postTool('uiLayoutReport', {
        root,
        designResolution: { width: 800, height: 600 },
        viewport: { width: 1600, height: 900 },
        fitMode: 'contain',
        maxNodes: 16,
        maxIssues: 32,
      });
      assert.equal(report.ok, true, JSON.stringify(report.body));
      assert.equal(report.body.complete, true);
      assert.ok(report.body.nodes.some((item) => item.uuid === root.id));

      const deactivate = await postTool('inspectorSet', { target: 'instance', reference: child, propertyPath: 'active', value: false });
      assert.equal(deactivate.ok, true, JSON.stringify(deactivate.body));
      const inactiveReport = await postTool('uiLayoutReport', {
        root,
        designResolution: { width: 800, height: 600 },
        viewport: { width: 1600, height: 900 },
      });
      const inactiveEntry = inactiveReport.body.nodes.find((item) => item.uuid === child.id);
      assert.equal(inactiveEntry.active, false);
      assert.equal(inactiveReport.body.issues.some((item) => item.nodeId === child.id), false);

      assert.ok(report.body.nodes.some((item) => item.uuid === child.id));
      const childEntry = report.body.nodes.find((item) => item.uuid === child.id);
      assert.equal(childEntry.worldCorners.length, 4);
      assert.equal(typeof childEntry.worldMatrix.m00, 'number');
      assert.equal(typeof report.body.fit.scale.x, 'number');
      assert.notEqual(childEntry.worldMatrix.m00, 1);
      assert.notEqual(childEntry.worldMatrix.m05, 1);

      const truncated = await postTool('uiLayoutReport', {
        root,
        designResolution: { width: 800, height: 600 },
        viewport: { width: 1600, height: 900 },
        maxNodes: 1,
      });
      assert.equal(truncated.ok, true, JSON.stringify(truncated.body));
      assert.equal(truncated.body.complete, false);
      assert.ok(truncated.body.truncation.length > 0);

      const sceneStateScript = `const target = ${JSON.stringify(root.id)}; const walk = (node) => { if (node.uuid === target) return { uuid: node.uuid, name: node.name, active: node.active, position: { x: node.position.x, y: node.position.y, z: node.position.z }, scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z }, rotation: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z, w: node.rotation.w } }; for (const child of node.children || []) { const hit = walk(child); if (hit) return hit; } return null; }; return walk(cc.director.getScene());`;
      const sceneBefore = await postTool('executeJavascript', { context: 'scene', code: sceneStateScript });
      const domBefore = await postTool('executeJavascript', { context: 'scene', code: "return document.querySelectorAll('[data-ccb3x-ui-layout-overlay]').length;" });
      assert.equal(sceneBefore.status, 200, JSON.stringify(sceneBefore.body));
      assert.equal(domBefore.status, 200, JSON.stringify(domBefore.body));
      const overlay = await postTool('uiLayoutReport', {
        root,
        designResolution: { width: 800, height: 600 },
        viewport: { width: 1600, height: 900 },
        overlay: true,
      });
      assert.equal(overlay.ok, true, JSON.stringify(overlay.body));
      assert.equal(overlay.body.overlay.requested, true);
      assert.equal(overlay.body.overlay.valid, true, JSON.stringify(overlay.body));
      assert.equal(overlay.body.overlay.rendered, true);
      assert.equal(overlay.body.overlay.cleaned, true);
      assert.equal(overlay.body.overlay.artifact.mimeType, 'image/png');
      assert.equal(overlay.body.overlay.artifact.encoding, 'base64');
      assert.match(overlay.body.overlay.artifact.data, /^[A-Za-z0-9+/]+={0,2}$/);
      assert.ok(overlay.body.overlay.artifact.byteLength > 0);
      assert.ok(overlay.body.overlay.artifact.width <= 2048 && overlay.body.overlay.artifact.height <= 2048);
      assert.equal(overlay.body.overlay.sourceNodeCount, overlay.body.nodes.length);
      assert.equal(overlay.body.overlay.sourceIssueCount, overlay.body.issues.length);
      assert.ok(overlay.body.overlay.responseBytes <= overlay.body.overlay.maxResponseBytes);
      assert.equal(overlay.body.overlay.dirtyPreserved, true);
      const sceneAfter = await postTool('executeJavascript', { context: 'scene', code: sceneStateScript });
      const domAfter = await postTool('executeJavascript', { context: 'scene', code: "return document.querySelectorAll('[data-ccb3x-ui-layout-overlay]').length;" });
      assert.deepEqual(sceneAfter.body.result, sceneBefore.body.result);
      assert.equal(domAfter.body.result, domBefore.body.result);
      const missing = await postTool('uiLayoutReport', {
        root: { id: '__ccb3x_missing_layout_report__', type: 'cc.Node' },
        designResolution: { width: 800, height: 600 },
        viewport: { width: 1600, height: 900 },
      });
      assert.equal(missing.status, 200, JSON.stringify(missing.body));
      assert.equal(missing.body.error.code, 'UI_LAYOUT_ROOT_NOT_FOUND');
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference: root });
    }
  });
});
