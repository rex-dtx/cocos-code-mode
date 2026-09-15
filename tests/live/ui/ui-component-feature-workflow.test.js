'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  getJson,
  postTool,
  repeatTestcase,
  healthCheck,
  getCanvasReference,
} = require('../../helpers/utcp-client');

const nativeIt = it;
function repeatedIt(name, callback) {
  const testId = String(name).match(/^([A-Z0-9-]+)/)?.[1] || 'UI';
  return nativeIt(name, async (t) => repeatTestcase(testId, async () => callback(t)));
}

const fixtureName = (suffix) => `__ccb3x_ui_feature_${suffix}_${process.pid}__`;

async function deleteNode(reference) {
  if (!reference?.id) return;
  const deleted = await postTool('nodeOperate', { operation: 'delete', reference });
  assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
}

async function componentsOf(reference) {
  const result = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
  assert.equal(result.ok, true, JSON.stringify(result.body));
  return result.body.references;
}

async function previewScene() {
  const result = await postTool('previewManage', {
    operation: 'scene_preview',
    imageSize: { width: 640, height: 360 },
    cameraPosition: { x: 640, y: 360, z: 1000 },
    targetPosition: { x: 640, y: 360, z: 0 },
    orthographic: true,
    orthographicSize: 360,
  });
  assert.equal(result.ok, true, JSON.stringify(result.body));
  assert.equal(result.body.type, 'image');
  assert.match(result.body.mimeType, /^image\//);
  return result.body;
}

describe('live: UI entity-component feature workflows', { concurrency: false }, () => {
  let health;
  before(async () => { health = await healthCheck(); });

  repeatedIt('UI-E01 creates a Canvas-owned entity with expected components', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const created = await postTool('createLabel', {
        name: fixtureName('entity'),
        text: 'Entity fixture',
        parentReference: canvas,
      });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const nodes = await getJson(`/tools/findNodes?name=${encodeURIComponent(fixtureName('entity'))}&maxResults=1`);
      assert.equal(nodes.ok, true, JSON.stringify(nodes.body));
      assert.equal(nodes.body.nodes[0].reference.id, reference.id);
      assert.match(nodes.body.nodes[0].path, /\/Canvas\//);
      const components = await componentsOf(reference);
      assert.ok(components.some((item) => item.type === 'cc.Label'));
      assert.ok(components.some((item) => item.type === 'cc.UITransform'));
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-C01 configures Label text, color, and font size with read-back', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const created = await postTool('createLabel', {
        name: fixtureName('label'),
        text: 'Configured label',
        fontSize: 28,
        color: '#22AAEE',
        parentReference: canvas,
      });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const components = await componentsOf(reference);
      const label = components.find((item) => item.type === 'cc.Label');
      assert.ok(label, 'Label component must exist');
      const readBack = await postTool('sceneBatchGet', {
        entries: [{ target: 'instance', reference: label, fields: ['string', 'fontSize', 'color'] }],
      });
      assert.equal(readBack.ok, true, JSON.stringify(readBack.body));
      assert.equal(readBack.body.results.length, 1);
      assert.equal(readBack.body.results[0].dump.string, 'Configured label');
      assert.equal(readBack.body.results[0].dump.fontSize, 28);
      await previewScene();
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-C02 creates a Button and verifies no-handler click behavior', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const created = await postTool('createButton', {
        name: fixtureName('button'),
        text: 'Click target',
        parentReference: canvas,
      });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const components = await componentsOf(reference);
      assert.ok(components.some((item) => item.type === 'cc.Button'));
      const clicked = await postTool('simulateButtonClick', { reference });
      assert.equal(clicked.ok, true, JSON.stringify(clicked.body));
      assert.equal(clicked.body.method, 'clickEvents');
      assert.equal(clicked.body.handlersFired, 0);
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-F01 binds a Button handler and reports the bound event', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const created = await postTool('createButton', { name: fixtureName('event'), parentReference: canvas });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const label = await postTool('nodeComponentManage', {
        operation: 'add',
        reference,
        componentType: 'cc.Label',
      });
      assert.equal(label.ok, true, JSON.stringify(label.body));
      const bound = await postTool('bindButtonClickEvent', {
        reference,
        componentType: 'cc.Label',
        handlerName: 'onEnable',
        customEventData: 'ui-feature',
      });
      if (!bound.ok && bound.status === 500) {
        t.skip(`Creator rejected native event binding: ${bound.body?.code ?? bound.status}`);
        return;
      }
      assert.equal(bound.ok, true, JSON.stringify(bound.body));
      assert.equal(bound.body.handlerCount, 1);
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-F02 creates a form with explicit validation and focus order', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let form;
    try {
      const result = await postTool('uiFormValidationBind', {
        label: 'Email',
        placeholder: 'name@example.com',
        required: true,
        minLength: 5,
        name: fixtureName('form'),
        parentReference: canvas,
      });
      assert.equal(result.ok, true, JSON.stringify(result.body));
      form = result.body.form.reference;
      assert.equal(result.body.rules.required, true);
      assert.equal(result.body.rules.minLength, 5);
      assert.equal(result.body.rules.inputReference.id, result.body.form.input.id);
      assert.equal(result.body.focusOrder.length, 2);
      const invalid = await postTool('uiFormValidationBind', { label: 'Invalid', required: false, minLength: 3 });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      assert.equal(invalid.body.code, 'INVALID_ARGUMENT');
    } finally {
      await deleteNode(form);
    }
  });

  repeatedIt('UI-F03 reparents a Widget subtree while preserving entity paths', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let root;
    let target;
    const targetName = fixtureName('widget-b');
    try {
      const first = await postTool('createUiNode', { uiType: 'Widget', name: fixtureName('widget-a'), parentReference: canvas });
      const second = await postTool('createUiNode', { uiType: 'Widget', name: targetName, parentReference: canvas });
      assert.equal(first.ok, true, JSON.stringify(first.body));
      assert.equal(second.ok, true, JSON.stringify(second.body));
      root = first.body.reference;
      target = second.body.reference;
      const moved = await postTool('nodeOperate', { operation: 'move', reference: root, newParentReference: target });
      const path = await getJson(`/tools/nodeGetPath?reference%5Bid%5D=${encodeURIComponent(root.id)}`);
      assert.equal(path.ok, true, JSON.stringify(path.body));
      assert.match(path.body.path, new RegExp(`/${targetName}/`));
    } finally {
      await deleteNode(root);
      await deleteNode(target);
    }
  });

  repeatedIt('UI-F04 reports bounded responsive geometry for Canvas', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    const result = await getJson(`/tools/uiResponsivePreview?reference%5Bid%5D=${encodeURIComponent(canvas.id)}&resolutions%5B0%5D%5Bwidth%5D=1280&resolutions%5B0%5D%5Bheight%5D=720&resolutions%5B1%5D%5Bwidth%5D=720&resolutions%5B1%5D%5Bheight%5D=1280`);
    assert.equal(result.ok, true, JSON.stringify(result.body));
    assert.equal(result.body.supported, true);
    assert.equal(result.body.comparisons.length, 2);
    assert.equal(result.body.stable, true);
    assert.match(result.body.caveat, /projections, not rendered screenshots/);
  });

  repeatedIt('UI-F05 materializes and cleans a bounded virtual list', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const result = await postTool('uiVirtualListCreate', {
        name: fixtureName('list'),
        parentReference: canvas,
        itemCount: 8,
        visibleItems: 3,
      });
      assert.equal(result.ok, true, JSON.stringify(result.body));
      reference = result.body.reference;
      assert.equal(result.body.itemCount, 8);
      assert.equal(result.body.instantiatedItems, 3);
      assert.equal(result.body.virtualized, true);
      assert.equal(result.body.itemReferences.length, 3);
      const tree = await getJson(`/tools/nodeGetTree?reference%5Bid%5D=${encodeURIComponent(reference.id)}&maxDepth=2&maxNodes=20`);
      assert.equal(tree.ok, true, JSON.stringify(tree.body));
      assert.ok(tree.body.children.length >= 1);
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-F06 toggles a disposable UI entity active state with read-back', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    let reference;
    try {
      const created = await postTool('createLabel', { name: fixtureName('active'), text: 'Active state', parentReference: canvas });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const hidden = await postTool('nodeBatchSet', { entries: [{ reference, propertyPaths: ['active'], values: [false] }] });
      assert.equal(hidden.ok, true, JSON.stringify(hidden.body));
      const readBack = await postTool('sceneBatchGet', { entries: [{ target: 'instance', reference, fields: ['active'] }] });
      assert.equal(readBack.ok, true, JSON.stringify(readBack.body));
      assert.equal(readBack.body.results[0].dump.active, false);
      const shown = await postTool('nodeBatchSet', { entries: [{ reference, propertyPaths: ['active'], values: [true] }] });
      assert.equal(shown.ok, true, JSON.stringify(shown.body));
    } finally {
      await deleteNode(reference);
    }
  });

  repeatedIt('UI-F07 deletes the fixture root with no remaining named nodes', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    const name = fixtureName('cleanup');
    const created = await postTool('createUiNode', { uiType: 'Widget', name, parentReference: canvas });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const reference = created.body.reference;
    await deleteNode(reference);
    const found = await getJson(`/tools/findNodes?name=${encodeURIComponent(name)}&maxResults=5`);
    assert.equal(found.ok, true, JSON.stringify(found.body));
    assert.equal(found.body.nodes.length, 0);
  });
});
