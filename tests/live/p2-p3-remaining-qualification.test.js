'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck } = require('../helpers/utcp-client');

// Live witnesses for the P2/P3 rows that were implemented and unit-tested but had no
// exact-artifact qualification evidence. Fixtures are created inside db://assets and
// removed in finally blocks so the active Creator project is not mutated permanently.
describe('live: P2/P3 remaining candidate qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  const refQuery = (reference) => `reference%5Bid%5D=${encodeURIComponent(reference.id)}`;

  async function removeSceneNode(name) {
    return postTool('executeJavascript', {
      context: 'scene',
      code: `const n=cc.director.getScene().getChildByName('${name}');if(n){n.removeFromParent();n.destroy();}return true;`,
    });
  }

  async function snapshotScene() {
    return postTool('executeJavascript', { context: 'editor', code: `await Editor.Message.request('scene','snapshot');return true;` });
  }

  // Creator replaces the source node while materialising a prefab asset, so the scene
  // identity returned by the creating call is stale and must be re-resolved by name.
  async function resolveSceneNodeByName(name) {
    const found = await postTool('executeJavascript', {
      context: 'scene',
      code: `const n=cc.director.getScene().getChildByName('${name}');return n?{uuid:n.uuid,name:n.name}:null;`,
    });
    if (found.status !== 200 || typeof found.body?.result?.uuid !== 'string') {
      throw new Error(`Scene node ${name} could not be re-resolved: ${JSON.stringify(found.body)}`);
    }
    return { id: found.body.result.uuid, type: 'cc.Node' };
  }

  async function readSceneState(name) {
    const found = await postTool('executeJavascript', {
      context: 'scene',
      code: `const n=cc.director.getScene().getChildByName('${name}');return n?{scale:{x:n.scale.x,y:n.scale.y,z:n.scale.z},active:n.active}:null;`,
    });
    if (found.status !== 200 || !found.body?.result) throw new Error(`Scene node ${name} has no transform: ${JSON.stringify(found.body)}`);
    return found.body.result;
  }

  async function readSceneOverrideCount(name) {
    const found = await postTool('executeJavascript', {
      context: 'scene',
      code: `const n=cc.director.getScene().getChildByName('${name}');const inst=n&&n._prefab&&n._prefab.instance;const list=inst&&Array.isArray(inst.propertyOverrides)?inst.propertyOverrides:[];return list.length;`,
    });
    if (found.status !== 200 || typeof found.body?.result !== 'number') throw new Error(`Scene node ${name} has no prefab instance: ${JSON.stringify(found.body)}`);
    return found.body.result;
  }

  it('edits an animation graph with serialized read-back and typed refusals', async (t) => {
    if (skipIfDown(t)) return;
    await repeatTestcase('P23-V01', async ({ iteration }) => {
      const preset = await getJson('/tools/assetQuery?pattern=db%3A%2F%2Finternal%2Fdefault_file_content%2Fanimgraph');
      if (preset.status !== 200 || preset.body.total < 1) {
        return { status: 'SKIP', reason: 'Creator does not expose the native animation graph preset fixture.' };
      }
      const assetPath = `db://assets/__ccb3x_graph_edit_${process.pid}_${iteration}__`;
      let reference;
      try {
        const created = await postTool('animationGraphCreate', { assetPath });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        reference = created.body.reference;
        assert.equal(typeof reference.id, 'string');

        const edited = await postTool('animationGraphEdit', {
          reference,
          operations: [
            { operation: 'add_node', node: { id: 'idle' } },
            { operation: 'add_node', node: { id: 'run' } },
            { operation: 'add_transition', transition: { id: 'idle-run', from: 'idle', to: 'run' } },
          ],
        });
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        assert.equal(edited.body.verified, true);
        assert.equal(edited.body.reference.id, reference.id);
        assert.deepEqual(edited.body.graph.nodes.map((node) => node.id), ['idle', 'run']);
        assert.deepEqual(edited.body.graph.transitions.map((edge) => edge.id), ['idle-run']);

        // Independent read-back through the separate inspection route.
        const inspected = await getJson(`/tools/animationGraphInspect?${refQuery(reference)}`);
        assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
        assert.equal(inspected.body.nodeCount, 2);
        assert.equal(inspected.body.transitionCount, 1);

        const duplicate = await postTool('animationGraphEdit', { reference, operations: [{ operation: 'add_node', node: { id: 'idle' } }] });
        assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
        assert.equal(duplicate.body.code, 'DUPLICATE_NODE_ID');

        const unknown = await postTool('animationGraphEdit', { reference, operations: [{ operation: 'remove_node', nodeId: '__missing_node__' }] });
        assert.equal(unknown.status, 404, JSON.stringify(unknown.body));
        assert.equal(unknown.body.code, 'NODE_NOT_FOUND');

        const unbounded = await postTool('animationGraphEdit', {
          reference,
          operations: Array.from({ length: 33 }, (_, index) => ({ operation: 'add_node', node: { id: `node_${index}` } })),
        });
        assert.equal(unbounded.status, 400, JSON.stringify(unbounded.body));
        assert.equal(unbounded.body.validationErrors?.[0]?.keyword, 'maxItems');

        // Refusals must not have mutated the persisted graph.
        const after = await getJson(`/tools/animationGraphInspect?${refQuery(reference)}`);
        assert.equal(after.body.nodeCount, 2);
        assert.equal(after.body.transitionCount, 1);
      } finally {
        if (reference) await postTool('assetOperate', { operation: 'delete', reference });
      }
    });
  });

  it('reverts and applies prefab instance overrides with source and instance read-back', async (t) => {
    if (skipIfDown(t)) return;
    await repeatTestcase('P23-V02', async ({ iteration }) => {
      const label = `__ccb3x_override_fixture_${process.pid}_${iteration}__`;
      const cloneLabel = `${label}_clone`;
      const assetPath = `db://assets/${label}.prefab`;
      let nodeReference;
      let prefabReference;
      try {
        const primitive = await postTool('nodeCreatePrimitive', { name: label, primitiveType: 'Cube' });
        assert.equal(primitive.status, 200, JSON.stringify(primitive.body));
        nodeReference = primitive.body.reference;

        // Own the prefab source inside db://assets so the witness never mutates db://internal.
        const linked = await postTool('prefabCreateFromNode', { reference: nodeReference, assetPath });
        assert.equal(linked.status, 200, JSON.stringify(linked.body));
        assert.equal(linked.body.persisted, true);
        assert.equal(linked.body.asset.url, assetPath);
        prefabReference = linked.body.asset;

        // The node is taken over by the new prefab asset, so its previous identity is dead.
        nodeReference = await resolveSceneNodeByName(label);
        const linkedInstance = await getJson(`/tools/prefabInstanceInspect?${refQuery(nodeReference)}`);
        assert.equal(linkedInstance.status, 200, JSON.stringify(linkedInstance.body));
        assert.equal(linkedInstance.body.isPrefabInstance, true);
        assert.equal(linkedInstance.body.prefabReference.id, prefabReference.id);

        // --- revert: an instance-only override must be discarded, not flushed to the source.
        const overridesBefore = await readSceneOverrideCount(label);
        const scaledForRevert = await postTool('nodeSetTransform', { reference: nodeReference, scale: { x: 3, y: 3, z: 3 } });
        assert.equal(scaledForRevert.status, 200, JSON.stringify(scaledForRevert.body));
        assert.deepEqual((await readSceneState(label)).scale, { x: 3, y: 3, z: 3 });
        assert.equal(await readSceneOverrideCount(label) > overridesBefore, true);

        const reverted = await postTool('prefabRevertOverrides', { reference: nodeReference });
        assert.equal(reverted.status, 200, JSON.stringify(reverted.body));
        assert.equal(reverted.body.operation, 'revert');
        assert.equal(reverted.body.persisted, true);
        assert.equal(reverted.body.sourceReadBack.url, assetPath);
        // The instance returns to the prefab source value instead of keeping the override.
        assert.deepEqual((await readSceneState(label)).scale, { x: 1, y: 1, z: 1 });

        // --- apply: a new instance override must be flushed into the prefab source.
        // Creator keeps instance-root transform overrides on the instance, so the witness uses
        // a non-transform override, which applyPrefab does flush.
        const hiddenForApply = await postTool('nodeSetTransform', { reference: nodeReference, active: false });
        assert.equal(hiddenForApply.status, 200, JSON.stringify(hiddenForApply.body));
        assert.equal((await readSceneState(label)).active, false);
        const applied = await postTool('prefabApplyOverrides', { reference: nodeReference });
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
        assert.equal(applied.body.operation, 'apply');
        assert.equal(applied.body.persisted, true);
        assert.equal(applied.body.sourceReadBack.url, assetPath);
        assert.match(String(applied.body.sourceReadBack.beforeSha256), /^[0-9a-f]{64}$/);
        assert.match(String(applied.body.sourceReadBack.afterSha256), /^[0-9a-f]{64}$/);
        assert.notEqual(applied.body.sourceReadBack.beforeSha256, applied.body.sourceReadBack.afterSha256);

        // A second instance of the same source proves the override reached the prefab asset.
        const clone = await postTool('prefabInstantiate', { reference: prefabReference, name: cloneLabel });
        assert.equal(clone.status, 200, JSON.stringify(clone.body));
        assert.equal((await readSceneState(cloneLabel)).active, false);

        // --- negatives.
        const selective = await postTool('prefabRevertOverrides', { reference: nodeReference, paths: ['_lscale'] });
        assert.equal(selective.status, 422, JSON.stringify(selective.body));
        assert.equal(selective.body.code, 'UNSUPPORTED_SELECTIVE_REVERT');

        const missing = await postTool('prefabApplyOverrides', { reference: { id: '__missing_prefab_instance__' } });
        assert.equal(missing.status, 404, JSON.stringify(missing.body));
        assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
      } finally {
        await removeSceneNode(cloneLabel);
        await removeSceneNode(label);
        await snapshotScene();
        if (prefabReference) await postTool('assetOperate', { operation: 'delete', reference: prefabReference });
      }
    });
  });

  it('compares skeleton and clip metadata for retarget inputs', async (t) => {
    if (skipIfDown(t)) return;
    await repeatTestcase('P23-V03', async () => {
      const models = await getJson('/tools/assetQuery?importer=model&limit=20');
      const assets = Array.isArray(models.body?.assets) ? models.body.assets : [];
      if (models.status !== 200 || assets.length < 2) {
        return { status: 'SKIP', reason: 'Active project has fewer than two imported model assets with skeleton metadata.' };
      }
      const [source, target] = assets;
      const result = await postTool('animationRetargetValidate', {
        sourceReference: { id: source.uuid },
        targetReference: { id: target.uuid },
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.automaticRetargeting, false);
      assert.equal(result.body.source.jointCount > 0, true);
      assert.equal(result.body.target.jointCount > 0, true);
      assert.equal(Array.isArray(result.body.issues), true);

      const unsupported = await postTool('animationRetargetValidate', {
        sourceReference: { id: source.uuid },
        targetReference: { id: '__missing_model__' },
      });
      assert.ok([404, 422].includes(unsupported.status), JSON.stringify(unsupported.body));
    });
  });
});
