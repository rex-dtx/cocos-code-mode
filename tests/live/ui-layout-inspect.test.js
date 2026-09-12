'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, postExpectedErrorTool, getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: uiLayoutInspect', () => {
  it('uses transformed ancestors and own corners, preserving nullable fields over HTTP', async t => {
    const health = await healthCheck();
    if (!health.ok) { t.skip(`editor not running: ${health.reason}`); return; }
    const created = await postTool('createUiNode', { uiType: 'Widget', name: '__ccb_layout_inspect_regression__' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const root = created.body.reference;
    try {
      const childResult = await postTool('createUiNode', { uiType: 'Widget', parentReference: root, name: '__ccb_layout_inspect_child__' });
      assert.equal(childResult.ok, true, JSON.stringify(childResult.body));
      const child = childResult.body.reference;
      const fixture = await postTool('executeJavascript', { context: 'scene', code: `
        const { director, UITransform, Widget, Node } = require('cc');
        const scene = director.getScene();
        const ids = ${JSON.stringify([root.id, child.id])};
        const found = new Map(); const stack = [scene];
        while (stack.length) { const n = stack.pop(); if (ids.includes(n.uuid)) found.set(n.uuid, n); stack.push(...n.children); }
        const parent = found.get(ids[0]), child = found.get(ids[1]);
        for (const n of [parent, child]) { const widget = n.getComponent(Widget); if (widget) widget.enabled = false; }
        parent.setParent(scene); parent.setPosition(100, 200, 0); parent.setScale(-2, 3, 1); parent.setRotationFromEuler(0, 0, 90);
        child.setPosition(10, 20, 0); child.setScale(1, 1, 1); child.setRotationFromEuler(0, 0, 0);
        const ui = child.getComponent(UITransform); ui.setContentSize(40, 20); ui.setAnchorPoint(0.25, 0.75);
        const oversized = new Node('__oversized_descendant__'); oversized.setParent(child);
        oversized.addComponent(UITransform).setContentSize(10000, 10000);
        return { ready: true };
      ` });
      assert.equal(fixture.ok, true, JSON.stringify(fixture.body));
      const before = await getJson('/tools/sceneGetInfo');
      assert.equal(before.ok, true, JSON.stringify(before.body));
      const result = await postTool('uiLayoutInspect', { reference: { id: child.id }, maxNodes: 1 });
      assert.equal(result.ok, true, JSON.stringify(result.body));
      const node = result.body.nodes[0];
      assert.equal(node.reference.id, child.id);
      assert.deepEqual(node.position, { x: 10, y: 20, z: 0 });
      for (const [key, expected] of Object.entries({ x: 25, y: 120, width: 60, height: 80 })) {
        assert.ok(Math.abs(node.worldRect[key] - expected) < 1e-5, `${key}: ${node.worldRect[key]} != ${expected}`);
      }
      assert.equal(result.body.truncated, true);
      const wholeScene = await postTool('uiLayoutInspect', { maxNodes: 1 });
      assert.equal(wholeScene.ok, true, JSON.stringify(wholeScene.body));
      assert.equal(wholeScene.body.nodes[0].size, null);
      assert.equal(wholeScene.body.nodes[0].anchor, null);
      assert.equal(wholeScene.body.nodes[0].worldRect, null);
      assert.deepEqual(wholeScene.body.nodes[0].components, []);
      const invalid = await postExpectedErrorTool('uiLayoutInspect', { maxNodes: 0 }, 'ui-layout-inspect.invalid-limit');
      assert.equal(invalid.status, 400);
      const after = await getJson('/tools/sceneGetInfo');
      assert.equal(after.body.dirty, before.body.dirty);
      assert.deepEqual(after.body.currentScene, before.body.currentScene);
    } finally {
      const removed = await postTool('nodeOperate', { operation: 'delete', reference: root });
      assert.equal(removed.ok, true, JSON.stringify(removed.body));
    }
  });
});
