'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: CC373 native UI creation fallback', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('creates Label, Button, and Sprite without internal UI prefabs', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = [];
    try {
      for (const [tool, component] of [['createLabel', 'cc.Label'], ['createButton', 'cc.Button'], ['createSprite', 'cc.Sprite']]) {
        const result = await postTool(tool, {});
        assert.equal(result.ok, true, `${tool}: ${JSON.stringify(result.body)}`);
        const reference = result.body?.reference;
        assert.equal(typeof reference?.id, 'string');
        created.push(reference);

        const components = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
        assert.equal(components.ok, true, `${tool} components: ${JSON.stringify(components.body)}`);
        assert.ok(components.body.references.some((item) => item.type === component), `${tool} missing ${component}`);
      }
    } finally {
      for (const reference of created) {
        await postTool('nodeOperate', { operation: 'delete', reference });
      }
    }
  });

  it('Creator 3.7 node lifecycle, component, inspector, reset, and lock APIs round-trip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = await postTool('nodeCreate', { name: '__ccb3x_qualification_node__' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const reference = created.body.reference;
    assert.equal(typeof reference?.id, 'string');

    try {
      const locked = await postTool('nodeOperate', { operation: 'lock', reference });
      assert.equal(locked.ok, true);
      assert.equal(locked.body.success, true);

      const unlocked = await postTool('nodeOperate', { operation: 'unlock', reference });
      assert.equal(unlocked.ok, true);
      assert.equal(unlocked.body.success, true);

      const set = await postTool('inspectorSet', {
        target: 'instance',
        reference,
        propertyPath: 'active',
        value: false,
      });
      assert.equal(set.ok, true);
      assert.equal(set.body.success, true);

      const added = await postTool('nodeComponentManage', {
        operation: 'add',
        reference,
        componentType: 'cc.Label',
      });
      assert.equal(added.ok, true);
      assert.equal(typeof added.body.reference?.id, 'string');

      const removed = await postTool('nodeComponentManage', {
        operation: 'remove',
        reference: added.body.reference,
      });
      assert.equal(removed.ok, true);
      assert.equal(removed.body.success, true);

      const reset = await postTool('nodeReset', {
        operation: 'property',
        references: [reference],
        propertyPath: 'active',
      });
      assert.equal(reset.ok, true);
      assert.equal(reset.body.success, true);
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference });
    }

    for (const [tool, body] of [
      ['nodeCreate', {}],
      ['nodeOperate', { operation: 'lock' }],
      ['inspectorSet', { target: 'instance', propertyPath: 'active', value: true }],
      ['nodeComponentManage', { operation: 'add', reference }],
      ['nodeReset', { operation: 'property' }],
    ]) {
      const invalid = await postTool(tool, body);
      assert.equal(invalid.status, 400, `${tool}: ${JSON.stringify(invalid.body)}`);
    }
  });

  it('Creator 3.7 primitive creation and node clipboard round-trip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = await postTool('nodeCreate', { name: '__ccb3x_clipboard_source__' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const source = created.body.reference;
    let pasted;
    let primitive;
    try {
      const copied = await postTool('nodeClipboard', {
        operation: 'copy',
        references: [source],
      });
      assert.equal(copied.ok, true);
      assert.equal(copied.body.success, true);
      assert.equal(copied.body.references.length, 1);

      const pastedResult = await postTool('nodeClipboard', {
        operation: 'paste',
        references: copied.body.references,
        targetReference: source,
        pasteAsChild: true,
      });
      assert.equal(pastedResult.ok, true);
      assert.equal(pastedResult.body.success, true);
      pasted = pastedResult.body.references?.[0];
      assert.equal(typeof pasted?.id, 'string');

      const primitiveResult = await postTool('nodeCreatePrimitive', {
        name: '__ccb3x_primitive__',
        primitiveType: 'Cube',
      });
      assert.equal(primitiveResult.ok, true);
      primitive = primitiveResult.body.reference;
      assert.equal(typeof primitive?.id, 'string');
    } finally {
      if (pasted?.id) await postTool('nodeOperate', { operation: 'delete', reference: pasted });
      if (primitive?.id) await postTool('nodeOperate', { operation: 'delete', reference: primitive });
      await postTool('nodeOperate', { operation: 'delete', reference: source });
    }

    const invalidClipboard = await postTool('nodeClipboard', {
      references: [source],
    });
    assert.equal(invalidClipboard.status, 400);
    const invalidPrimitive = await postTool('nodeCreatePrimitive', {
      name: '__ccb3x_invalid_primitive__',
      primitiveType: 'Unknown',
    });
    assert.equal(invalidPrimitive.status, 400);
  });


  it('Creator 3.7 editor preference setter preserves typed values', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const result = await postTool('setEditorPreference', { key: 'serverPort', value: 49650 });
    assert.equal(result.ok, true);
    assert.equal(result.body.success, true);
    assert.equal(result.body.key, 'serverPort');
    assert.equal(result.body.value, 49650);

    const invalid = await postTool('setEditorPreference', { value: 49650 });
    assert.equal(invalid.status, 400);
  });

  it('Creator 3.7 direct UI node API creates and validates native controls', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = await postTool('createUiNode', {
      uiType: 'Label',
      name: '__ccb3x_direct_ui_node__',
    });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const reference = created.body.reference;
    assert.equal(typeof reference?.id, 'string');
    try {
      const components = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
      assert.equal(components.ok, true);
      assert.ok(components.body.references.some((item) => item.type === 'cc.Label'));
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference });
    }

    const invalid = await postTool('createUiNode', { uiType: 'Unknown' });
    assert.equal(invalid.status, 400);
  });
});