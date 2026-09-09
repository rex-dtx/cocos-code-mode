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

  it('Creator 3.7 asset create, import, content save, and delete round-trip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const assetPath = 'db://assets/__ccb3x_qualification__.ts';
    const importedPath = 'db://assets/__ccb3x_import__.json';
    let reference;
    let importedReference;
    try {
      const created = await postTool('assetCreate', {
        assetPath,
        preset: 'typescript',
      });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      assert.equal(typeof reference?.id, 'string');

      const saved = await postTool('assetSaveContent', {
        reference,
        content: 'export const ccb3xQualification = 1;\n',
      });
      assert.equal(saved.ok, true, JSON.stringify(saved.body));
      assert.equal(typeof saved.body.reference?.id, 'string');

      const env = await getJson('/tools/editorEnvInfo');
      assert.equal(env.ok, true);
      const imported = await postTool('assetImport', {
        sourceFilesystemPath: `${env.body.projectPath}/package.json`,
        targetAssetPath: importedPath,
      });
      assert.equal(imported.ok, true, JSON.stringify(imported.body));
      importedReference = imported.body.reference;
      assert.equal(typeof importedReference?.id, 'string');

      const deleted = await postTool('assetOperate', {
        operation: 'delete',
        reference: saved.body.reference,
      });
      assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
      assert.equal(typeof deleted.body.reference?.id, 'string');
      reference = undefined;

      const deletedImport = await postTool('assetOperate', {
        operation: 'delete',
        reference: importedReference,
      });
      assert.equal(deletedImport.ok, true, JSON.stringify(deletedImport.body));
      importedReference = undefined;
    } finally {
      if (reference?.id) await postTool('assetOperate', { operation: 'delete', reference });
      if (importedReference?.id) await postTool('assetOperate', { operation: 'delete', reference: importedReference });
    }

    const invalidCreate = await postTool('assetCreate', { assetPath });
    assert.equal(invalidCreate.status, 400);
    const invalidImport = await postTool('assetImport', { targetAssetPath: importedPath });
    assert.equal(invalidImport.status, 400);
    const invalidSave = await postTool('assetSaveContent', { reference: { id: 'missing' } });
    assert.equal(invalidSave.status, 400);
    const invalidOperate = await postTool('assetOperate', { reference: { id: 'missing' } });
    assert.equal(invalidOperate.status, 400);
  });

  it('Creator 3.7 component method invocation reaches callable component APIs', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = await postTool('createLabel', { name: '__ccb3x_method_node__' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const node = created.body.reference;
    try {
      const components = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(node.id)}`);
      assert.equal(components.ok, true);
      const label = components.body.references.find((item) => item.type === 'cc.Label');
      assert.equal(typeof label?.id, 'string');

      const result = await postTool('callComponentMethod', {
        reference: label,
        methodName: 'unscheduleAllCallbacks',
      });
      assert.equal(result.ok, true, JSON.stringify(result.body));
      assert.ok(result.body === null || result.body.result === null);
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference: node });
    }

    const invalid = await postTool('callComponentMethod', { reference: node });
    assert.equal(invalid.status, 400);
  });

  it('Creator 3.7 prefab duplicate and JSON edit round-trip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const assets = await getJson('/tools/assetQuery?importer=prefab&limit=1');
    assert.equal(assets.ok, true, JSON.stringify(assets.body));
    const source = assets.body.assets?.[0];
    assert.equal(typeof source?.uuid, 'string');
    const targetAssetPath = 'db://assets/__ccb3x_prefab_qualification__.prefab';
    let duplicate;
    try {
      const copied = await postTool('duplicatePrefab', {
        reference: { id: source.uuid, type: 'cc.Prefab' },
        targetAssetPath,
      });
      assert.equal(copied.ok, true, JSON.stringify(copied.body));
      duplicate = copied.body.reference;
      assert.equal(typeof duplicate?.id, 'string');

      const read = await getJson(`/tools/readPrefabJson?reference%5Bid%5D=${encodeURIComponent(duplicate.id)}`);
      assert.equal(read.ok, true, JSON.stringify(read.body));
      assert.equal(typeof read.body.content, 'string');
      const edited = await postTool('editPrefabJson', {
        reference: duplicate,
        content: read.body.content,
      });
      assert.equal(edited.ok, true, JSON.stringify(edited.body));
      assert.equal(edited.body.success, true);
    } finally {
      if (duplicate?.id) await postTool('assetOperate', { operation: 'delete', reference: duplicate });
    }

    const invalidDuplicate = await postTool('duplicatePrefab', { targetAssetPath });
    assert.equal(invalidDuplicate.status, 400);
    const invalidEdit = await postTool('editPrefabJson', { reference: { id: 'missing' }, content: '{}' });
    assert.equal(invalidEdit.status, 404);
  });

  it('Creator 3.7 property array API reorders node children and validates input', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const parentResult = await postTool('nodeCreate', { name: '__ccb3x_array_parent__' });
    assert.equal(parentResult.ok, true, JSON.stringify(parentResult.body));
    const parent = parentResult.body.reference;
    const children = [];
    try {
      for (const name of ['__ccb3x_array_a__', '__ccb3x_array_b__']) {
        const created = await postTool('nodeCreate', { name, parentReference: parent });
        assert.equal(created.ok, true, JSON.stringify(created.body));
        children.push(created.body.reference);
      }

      const moved = await postTool('propertyArrayElement', {
        operation: 'move',
        reference: parent,
        propertyPath: 'children',
        index: 0,
        toIndex: 1,
      });
      assert.equal(moved.ok, true, JSON.stringify(moved.body));
      assert.equal(moved.body.success, true);
    } finally {
      for (const reference of [...children, parent]) {
        await postTool('nodeOperate', { operation: 'delete', reference });
      }
    }

    const invalid = await postTool('propertyArrayElement', {
      operation: 'move',
      reference: parent,
      propertyPath: 'children',
      index: 0,
    });
    assert.equal(invalid.status, 400);
  });
  it('Creator 3.7 keyboard input APIs emit safe editor events and reject malformed combos', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }

    const press = await postTool('simulateKeyPress', { key: 'Escape' });
    assert.equal(press.ok, true, JSON.stringify(press.body));
    assert.deepEqual(press.body, { success: true, key: 'Escape' });

    const combo = await postTool('simulateKeyCombo', { combo: 'Ctrl+Shift+Escape' });
    assert.equal(combo.ok, true, JSON.stringify(combo.body));
    assert.deepEqual(combo.body, { success: true, combo: 'Ctrl+Shift+Escape' });

    const missingKey = await postTool('simulateKeyPress', {});
    assert.equal(missingKey.status, 400);
    const modifierOnly = await postTool('simulateKeyCombo', { combo: 'Ctrl+' });
    assert.equal(modifierOnly.status, 400);
    const unsupportedModifier = await postTool('simulateKeyCombo', { combo: 'Super+D' });
    assert.equal(unsupportedModifier.status, 400);
  });
  it('Creator 3.7 mouse input APIs emit bounded off-screen events and validate coordinates', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }

    const click = await postTool('simulateMouseClick', {
      x: -100, y: -100, button: 'right', clickCount: 2,
    });
    assert.equal(click.ok, true, JSON.stringify(click.body));
    assert.deepEqual(click.body, { success: true });

    const drag = await postTool('simulateMouseDrag', {
      x: -100, y: -100, x2: -90, y2: -90, steps: 2,
    });
    assert.equal(drag.ok, true, JSON.stringify(drag.body));
    assert.deepEqual(drag.body, { success: true });

    const missingClickCoordinate = await postTool('simulateMouseClick', { x: -100 });
    assert.equal(missingClickCoordinate.status, 400);
    const missingDragCoordinate = await postTool('simulateMouseDrag', {
      x: -100, y: -100, x2: -90,
    });
    assert.equal(missingDragCoordinate.status, 400);
  });

});