'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getJson, getExpectedErrorJson, postTool, repeatTestcase, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

describe('live: read-only candidate qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('audits prefab references and computes a bounded override diff', async (t) => {
    if (skipIfDown(t)) return;
    const marker = process.env.CCB_PREFAB_FIXTURE_UUID || 'f8befe54-5f06-4454-b61b-eb99915fc8f8';
    const dialog = process.env.CCB_PREFAB_BASELINE_UUID || '9c561266-65f5-4f20-9947-ecd2353c2111';
    const audit = await getJson(`/tools/prefabReferenceAudit?reference%5Bid%5D=${marker}`);
    if (audit.status === 404) { t.skip(`Prefab fixture ${marker} is absent in active project`); return; }
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.equal(audit.body.valid, true);
    assert.deepEqual(audit.body.missingReferences, []);
    const diff = await getJson(`/tools/prefabOverrideDiff?reference%5Bid%5D=${marker}&baselineReference%5Bid%5D=${dialog}`);
    assert.equal(diff.status, 200, JSON.stringify(diff.body));
    assert.equal(diff.body.equal, false);
    assert.ok(diff.body.changes.length > 0);
    const missing = await getExpectedErrorJson('/tools/prefabReferenceAudit?reference%5Bid%5D=__missing_prefab__', 'candidate.prefabReferenceAudit.negative.v1');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
  });

  it('audits active UI labels and computes deterministic focus links', async (t) => {
    if (skipIfDown(t)) return;
    const canvas = await getCanvasReference();
    const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const scene=cc.director.getScene();const stack=[scene];let canvas=null;while(stack.length&&!canvas){const n=stack.pop();if(n.getComponent&&n.getComponent(cc.Canvas))canvas=n;else stack.push(...(n.children||[]));}if(!canvas)return {skip:true};const UITransform=cc.js.getClassByName('cc.UITransform');const old=canvas.getChildByName('__candidate_focus_root__');if(old){old.removeFromParent();old.destroy();}const root=new cc.Node('__candidate_focus_root__');canvas.addChild(root);root.addComponent(UITransform).setContentSize(400,200);const ids=[];for(const [name,x] of [['First',-100],['Second',100]]){const n=new cc.Node(name);root.addChild(n);n.setPosition(x,0,0);n.addComponent(UITransform).setContentSize(80,40);ids.push(n.uuid);}return {root:root.uuid,ids,canvas:canvas.uuid};`,
    });
    assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
    if (fixture.body.result?.skip) { t.skip('Active scene has no Canvas component fixture'); return; }
    const { root, ids } = fixture.body.result;
    try {
      const accessibility = await getJson(`/tools/uiAccessibilityAudit?root%5Bid%5D=${encodeURIComponent(root)}&maxNodes=16`);
      assert.equal(accessibility.status, 200, JSON.stringify(accessibility.body));
      assert.ok(Array.isArray(accessibility.body.nodes));
      const focus = await getJson(`/tools/uiFocusNavigation?axis=horizontal&references%5B0%5D%5Bid%5D=${encodeURIComponent(ids[0])}&references%5B1%5D%5Bid%5D=${encodeURIComponent(ids[1])}`);
      assert.equal(focus.status, 200, JSON.stringify(focus.body));
      assert.equal(focus.body.links.length, 2);
      const missing = await getExpectedErrorJson('/tools/uiAccessibilityAudit?root%5Bid%5D=__missing_ui_root__', 'candidate.uiAccessibilityAudit.negative.v1');
      assert.equal(missing.status, 200);
      assert.equal(missing.body.error.code, 'UI_ACCESSIBILITY_ROOT_NOT_FOUND');
      const invalidFocus = await getExpectedErrorJson('/tools/uiFocusNavigation?axis=horizontal&references%5B0%5D%5Bid%5D=__missing_ui_node__', 'candidate.uiFocusNavigation.negative.v1');
      assert.equal(invalidFocus.status, 404);
    } finally {
      const cleanup = await postTool('executeJavascript', {
        context: 'scene',
        code: `const canvas=cc.director.getScene().getChildByName('Canvas');const n=canvas&&canvas.getChildByName('__candidate_focus_root__');if(n){n.removeFromParent();n.destroy();}return true;`,
      });
      assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
    }
  });

  it('audits serialized scene references and missing asset dependencies', async (t) => {
    const scene = process.env.CCB_SCENE_REFERENCE_UUID || '80dddede-15e3-4d8e-8f37-0f1263a0867c';
    const references = await getJson(`/tools/sceneReferenceValidate?reference%5Bid%5D=${scene}&maxReferences=20`);
    if (references.status === 404) { t.skip(`Scene fixture ${scene} is absent in active project`); return; }
    assert.equal(references.status, 200, JSON.stringify(references.body));
    assert.ok(Array.isArray(references.body.references));
    assert.ok(references.body.source.reopened);
    const missingPath = process.env.CCB_MISSING_REFERENCE_SCENE;
    if (missingPath) {
      const missing = await getJson(`/tools/assetMissingReferenceAudit?assetPath=${encodeURIComponent(missingPath)}&maxScenes=4&maxReferences=20`);
      assert.equal(missing.status, 200, JSON.stringify(missing.body));
      assert.equal(missing.body.complete, true);
      assert.ok(missing.body.scannedScenes >= 1);
    }
    const invalid = await getExpectedErrorJson('/tools/sceneReferenceValidate?reference%5Bid%5D=__missing_scene__', 'candidate.sceneReferenceValidate.negative.v1');
    assert.equal(invalid.status, 404);
  });
  it('executes a bounded asset refresh batch and reports invalid batches', async (t) => {
    if (skipIfDown(t)) return;
    const refreshed = await postTool('assetBatchOperate', {
      items: [{ operation: 'refresh', reference: { id: '3b970e1b-5e5a-4168-ae4f-0f1ed51e5551', type: 'cc.Asset' } }],
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.equal(refreshed.body.succeeded, 1);
    assert.equal(refreshed.body.failed, 0);
    assert.equal(refreshed.body.partial, false);
    const invalid = await postTool('assetBatchOperate', { items: [] });
    assert.equal(invalid.status, 400);
  });

  it('imports one bounded asset and records a typed missing-source outcome', async (t) => {
    if (skipIfDown(t)) return;
    const source = path.join(os.tmpdir(), `ccp3x-import-${process.pid}.txt`);
    fs.writeFileSync(source, 'ccp3x asset batch import witness\n', 'utf8');
    let imported;
    try {
      const result = await postTool('assetBatchImport', {
        items: [{ sourceFilesystemPath: source, targetAssetPath: 'db://assets/__ccp3x_candidate_import__.txt' }],
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.succeeded, 1);
      assert.equal(result.body.failed, 0);
      imported = result.body.outcomes[0].reference;
      const missing = await postTool('assetBatchImport', {
        items: [{ sourceFilesystemPath: `${source}.missing`, targetAssetPath: 'db://assets/__ccp3x_candidate_missing__.txt' }],
      });
      assert.equal(missing.status, 200);
      assert.equal(missing.body.succeeded, 0);
      assert.equal(missing.body.failed, 1);
      assert.equal(missing.body.outcomes[0].ok, false);
    } finally {
      if (imported) {
        const cleanup = await postTool('assetBatchOperate', { items: [{ operation: 'delete', reference: imported }] });
        assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
        assert.equal(cleanup.body.succeeded, 1);
      }
      fs.rmSync(source, { force: true });
    }
  });

  it('instantiates a typed prefab with stable source and scene read-back', async (t) => {
    if (skipIfDown(t)) return;
    const name = '__ccp3x_candidate_prefab__';
    const inventory = await getJson('/tools/assetQuery?importer=prefab&limit=50');
    if (inventory.status !== 200 || !Array.isArray(inventory.body?.assets) || inventory.body.assets.length === 0) { t.skip('No prefab asset fixture is available in the active project'); return; }
    const preferred = inventory.body.assets.find((asset) => asset.url === 'db://internal/default_prefab/Camera.prefab')
      ?? inventory.body.assets.find((asset) => asset.url === 'db://internal/default_prefab/2d/Camera.prefab')
      ?? inventory.body.assets.find((asset) => asset.type === 'cc.Prefab');
    const fixture = process.env.CCB_PREFAB_INSTANTIATE_UUID || preferred?.uuid;
    assert.equal(typeof fixture, 'string', 'discovered prefab fixture uuid');
    try {
      const created = await postTool('prefabInstantiate', {
        reference: { id: fixture, type: 'cc.Prefab' },
        name,
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.persisted, true);
      assert.equal(created.body.source.id, fixture);
      assert.equal(created.body.readBack.name.value, name);
      const missing = await postTool('prefabInstantiate', {
        reference: { id: '__missing_prefab__', type: 'cc.Prefab' },
        name: '__must_not_exist__',
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
    } finally {
      const cleanup = await postTool('executeJavascript', {
        context: 'scene',
        code: `const n=cc.director.getScene().getChildByName('${name}');if(n){n.removeFromParent();n.destroy();}return true;`,
      });
      assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
      const snapshot = await postTool('executeJavascript', {
        context: 'editor',
        code: `await Editor.Message.request('scene','snapshot');return true;`,
      });
      assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
    }
  });

  it('validates target project settings without mutation', async (t) => {
    if (skipIfDown(t)) return;
    await repeatTestcase('PROJECT-SETTINGS-V01', async () => {
      const valid = await getJson('/tools/projectSettingsValidate?target=web-desktop');
      assert.equal(valid.status, 200, JSON.stringify(valid.body));
      assert.equal(valid.body.valid, true);
      assert.equal(valid.body.target, 'web-desktop');
      assert.equal(valid.body.checkedPaths, 0);
      assert.deepEqual(valid.body.issues, []);

      const missingPath = '__ccp3x_missing_setting__';
      const invalid = await getJson(`/tools/projectSettingsValidate?target=web-desktop&requiredPaths%5B0%5D=${missingPath}`);
      assert.equal(invalid.status, 200, JSON.stringify(invalid.body));
      assert.equal(invalid.body.valid, false);
      assert.equal(invalid.body.checkedPaths, 1);
      assert.deepEqual(invalid.body.issues, [{
        path: missingPath,
        code: 'MISSING_SETTING',
        message: `Required setting '${missingPath}' is not present.`,
      }]);
    });
  });
});
