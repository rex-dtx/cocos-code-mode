'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, getExpectedErrorJson, postTool, postExpectedErrorTool, healthCheck } = require('../helpers/utcp-client');

describe('live: candidate expansion qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('qualifies bounded asset catalog and importer audits', async (t) => {
    if (skipIfDown(t)) return;
    const catalog = await getJson('/tools/assetCatalogManifest?maxAssets=3');
    assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
    assert.equal(catalog.body.assets.length, 3);
    assert.equal(catalog.body.count, 3);
    assert.ok(catalog.body.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));

    const invalidCatalog = await getJson('/tools/assetCatalogManifest?maxAssets=0');
    assert.equal(invalidCatalog.status, 400);

    const importer = await getJson('/tools/assetImporterAudit?reference%5Bid%5D=4e03008c-cb99-412b-90dc-6dbe0c7a2a28');
    assert.equal(importer.status, 200, JSON.stringify(importer.body));
    assert.equal(importer.body.valid, true);
    assert.equal(importer.body.importer, 'typescript');
    assert.equal(importer.body.source.uuid, '4e03008c-cb99-412b-90dc-6dbe0c7a2a28');

    const missingImporter = await getExpectedErrorJson('/tools/assetImporterAudit?reference%5Bid%5D=__missing_candidate_asset__', 'candidate.assetImporterAudit.negative.v1');
    assert.equal(missingImporter.status, 404);
    assert.equal(missingImporter.body.code, 'TARGET_NOT_FOUND');
  });

  it('qualifies bounded scene hierarchy validation with duplicate-path and limit witnesses', async (t) => {
    if (skipIfDown(t)) return;
    const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const sc=cc.director.getScene();for(const name of ['__candidate_hierarchy__']){const old=sc.getChildByName(name);if(old){old.removeFromParent();old.destroy();}}
const root=new cc.Node('__candidate_hierarchy__');sc.addChild(root);const child=new cc.Node('__candidate_leaf__');root.addChild(child);return {root:root.uuid,child:child.uuid};`,
    });
    assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
    try {
      const valid = await getJson(`/tools/sceneHierarchyValidate?rootReference%5Bid%5D=${encodeURIComponent(fixture.body.result.root)}&limit=1000`);
      assert.equal(valid.status, 200, JSON.stringify(valid.body));
      assert.equal(valid.body.valid, true);
      assert.ok(valid.body.checkedNodes >= 2);
      assert.deepEqual(valid.body.issues, []);
      const duplicate = await postTool('executeJavascript', {
        context: 'scene',
        code: `const root=cc.director.getScene().getChildByName('__candidate_hierarchy__');root.addChild(new cc.Node('__candidate_duplicate__'));root.addChild(new cc.Node('__candidate_duplicate__'));return true;`,
      });
      assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
      const invalid = await getJson(`/tools/sceneHierarchyValidate?rootReference%5Bid%5D=${encodeURIComponent(fixture.body.result.root)}&limit=1000`);
      assert.equal(invalid.status, 200, JSON.stringify(invalid.body));
      assert.equal(invalid.body.valid, false);
      assert.ok(invalid.body.issues.some((issue) => issue.includes('duplicate path')));
      const bounded = await getJson(`/tools/sceneHierarchyValidate?rootReference%5Bid%5D=${encodeURIComponent(fixture.body.result.root)}&limit=1`);
      assert.equal(bounded.status, 200, JSON.stringify(bounded.body));
      assert.equal(bounded.body.valid, false);
      assert.equal(bounded.body.truncated, true);
      const invalidLimit = await getJson('/tools/sceneHierarchyValidate?limit=0');
      const missingRoot = await getExpectedErrorJson('/tools/sceneHierarchyValidate?rootReference%5Bid%5D=__missing_hierarchy_root__', 'candidate.sceneHierarchyValidate.negative.v1');
      assert.equal(missingRoot.status, 404);
      assert.equal(missingRoot.body.code, 'TARGET_NOT_FOUND');
      assert.equal(invalidLimit.status, 400);
    } finally {
      const cleanup = await postTool('executeJavascript', {
        context: 'scene',
        code: `const n=cc.director.getScene().getChildByName('__candidate_hierarchy__');if(n){n.removeFromParent();n.destroy();}return true;`,
      });
      assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
    }
  });

  it('qualifies particle, terrain, and physics topology audits with real scene fixtures', async (t) => {
    if (skipIfDown(t)) return;
    const fixture = await postTool('executeJavascript', {
      context: 'scene',
      code: `const sc=cc.director.getScene();
for(const name of ['__candidate_particle__','__candidate_terrain__','__candidate_p2__','__candidate_p2_bad__','__candidate_p3__','__candidate_p3_bad__','__candidate_audio__']){const old=sc.getChildByName(name);if(old){old.removeFromParent();old.destroy();}}
const out={};
function add(name,types){const n=new cc.Node(name);sc.addChild(n);out[name]={id:n.uuid,types:[]};for(const type of types){const C=cc.js.getClassByName(type);if(C){n.addComponent(C);out[name].types.push(type);}}}
add('__candidate_particle__',['cc.ParticleSystem']);
add('__candidate_terrain__',['cc.Terrain']);
add('__candidate_p2__',['cc.RigidBody2D','cc.BoxCollider2D']);
add('__candidate_p2_bad__',['cc.RigidBody2D']);
add('__candidate_p3__',['cc.RigidBody','cc.BoxCollider']);
add('__candidate_p3_bad__',['cc.RigidBody']);
add('__candidate_audio__',['cc.AudioSource']);
return out;`,
    });
    assert.equal(fixture.status, 200, JSON.stringify(fixture.body));
    const ids = fixture.body.result;
    try {
      const audioSet = await postTool('executeJavascript', {
        context: 'editor',
        code: `return await Editor.Message.request('scene','set-property',{uuid:'${ids.__candidate_audio__.id}',path:'_components.0.clip',dump:{value:{uuid:'a0e999f9-01fa-45df-a8e5-6f996e15735a'},type:'cc.AudioClip'}});`,
      });
      assert.equal(audioSet.status, 200, JSON.stringify(audioSet.body));
      assert.equal(audioSet.body.result, true);
      const particle = await getJson(`/tools/particleInspect?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_particle__.id)}`);
      assert.equal(particle.status, 200, JSON.stringify(particle.body));
      assert.equal(particle.body.count, 1);
      assert.equal(particle.body.systems[0].type, 'cc.ParticleSystem');
      const particleInspectNegative = await getExpectedErrorJson('/tools/particleInspect?reference%5Bid%5D=__missing_candidate_node__', 'candidate.particleInspect.negative.v1');
      assert.equal(particleInspectNegative.status, 404);
      const particleValid = await getJson(`/tools/particleValidate?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_particle__.id)}`);
      const particleNegative = await getJson(`/tools/particleValidate?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p2__.id)}`);
      assert.equal(particleValid.body.valid, true);
      assert.equal(particleNegative.status, 200);
      assert.equal(particleNegative.body.valid, false);

      const terrain = await getJson(`/tools/terrainInspect?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_terrain__.id)}`);
      assert.equal(terrain.status, 200, JSON.stringify(terrain.body));
      assert.equal(terrain.body.count, 1);
      const terrainNegative = await getExpectedErrorJson('/tools/terrainInspect?reference%5Bid%5D=__missing_candidate_node__', 'candidate.terrainInspect.negative.v1');
      assert.equal(terrainNegative.status, 404);

      const p2 = await getJson(`/tools/physics2dTopologyAudit?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p2__.id)}`);
      assert.equal(p2.status, 200, JSON.stringify(p2.body));
      assert.equal(p2.body.valid, true);
      assert.deepEqual(p2.body.nodes[0].bodies, ['cc.RigidBody2D']);
      const p2Negative = await getJson(`/tools/physics2dTopologyAudit?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p2_bad__.id)}`);
      assert.equal(p2Negative.status, 200);
      assert.equal(p2Negative.body.valid, false);
      assert.match(p2Negative.body.issues[0], /no collider/);
      const p2Box2d = await getJson(`/tools/physics2dCompatibilityAudit?backend=box2d&reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p2__.id)}`);
      assert.equal(p2Box2d.status, 200, JSON.stringify(p2Box2d.body));
      assert.equal(p2Box2d.body.valid, true);
      assert.equal(p2Box2d.body.backend, 'box2d');
      const p2Builtin = await getJson(`/tools/physics2dCompatibilityAudit?backend=builtin&reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p2__.id)}`);
      assert.equal(p2Builtin.status, 200, JSON.stringify(p2Builtin.body));
      assert.equal(p2Builtin.body.valid, false);
      assert.match(p2Builtin.body.issues[0], /requires the box2d backend/);

      const p3 = await getJson(`/tools/physics3dTopologyAudit?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p3__.id)}`);
      assert.equal(p3.status, 200, JSON.stringify(p3.body));
      assert.equal(p3.body.valid, true);
      const p3Negative = await getExpectedErrorJson('/tools/physics3dTopologyAudit?reference%5Bid%5D=__missing_candidate_node__', 'candidate.physics3dTopologyAudit.negative.v1');
      assert.equal(p3Negative.status, 404);
      const p3Valid = await getJson(`/tools/physics3dValidate?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p3__.id)}`);
      assert.equal(p3Valid.status, 200);
      assert.equal(p3Valid.body.valid, true);
      const p3Invalid = await getJson(`/tools/physics3dValidate?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_p3_bad__.id)}`);
      assert.equal(p3Invalid.status, 200);
      assert.equal(p3Invalid.body.valid, false);
      assert.match(p3Invalid.body.issues[0], /no 3D collider/);
      const audio = await getJson(`/tools/audioSourceAudit?reference%5Bid%5D=${encodeURIComponent(ids.__candidate_audio__.id)}`);
      assert.equal(audio.status, 200, JSON.stringify(audio.body));
      assert.equal(audio.body.valid, true);
      assert.equal(audio.body.checkedSources, 1);
      assert.equal(audio.body.sources[0].clip.uuid, 'a0e999f9-01fa-45df-a8e5-6f996e15735a');
      const audioNegative = await getExpectedErrorJson('/tools/audioSourceAudit?reference%5Bid%5D=__missing_candidate_node__', 'candidate.audioSourceAudit.negative.v1');
      assert.equal(audioNegative.status, 404);
    } finally {
      const cleanup = await postTool('executeJavascript', {
        context: 'scene',
        code: `const sc=cc.director.getScene();for(const name of ['__candidate_particle__','__candidate_terrain__','__candidate_p2__','__candidate_p2_bad__','__candidate_p3__','__candidate_p3_bad__','__candidate_audio__']){const n=sc.getChildByName(name);if(n){n.removeFromParent();n.destroy();}}return true;`,
      });
      assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
    }
  });

  it('qualifies compound Box2D body creation with rollback-safe preflight', async (t) => {
    if (skipIfDown(t)) return;
    const name = '__candidate_create_p2_body__';
    const cleanup = async () => {
      const removed = await postTool('executeJavascript', {
        context: 'scene',
        code: `const sc=cc.director.getScene();const n=sc.getChildByName('${name}');if(n){n.removeFromParent();n.destroy();}return !sc.getChildByName('${name}');`,
      });
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.result, true);
      const snapshot = await postTool('executeJavascript', {
        context: 'editor',
        code: `await Editor.Message.request('scene','snapshot');return true;`,
      });
      assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
    };
    await cleanup();
    try {
      const builtin = await postExpectedErrorTool('physics2dCreateBody', { backend: 'builtin', name }, 'candidate.physics2dCreateBody.negative.v1');
      assert.equal(builtin.status, 422, JSON.stringify(builtin.body));
      assert.equal(builtin.body.code, 'UNSUPPORTED_BACKEND');
      const absentAfterPreflight = await postTool('executeJavascript', {
        context: 'scene',
        code: `return !cc.director.getScene().getChildByName('${name}');`,
      });
      assert.equal(absentAfterPreflight.body.result, true);

      const created = await postTool('physics2dCreateBody', { backend: 'box2d', collider: 'circle', name });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.backend, 'box2d');
      assert.equal(created.body.bodyType, 'cc.RigidBody2D');
      assert.equal(created.body.colliderType, 'cc.CircleCollider2D');
      assert.ok(created.body.components.includes('cc.RigidBody2D'));
      assert.ok(created.body.components.includes('cc.CircleCollider2D'));
      const topology = await getJson(`/tools/physics2dTopologyAudit?reference%5Bid%5D=${encodeURIComponent(created.body.reference.id)}`);
      assert.equal(topology.status, 200, JSON.stringify(topology.body));
      assert.equal(topology.body.valid, true);
      assert.deepEqual(topology.body.nodes[0].colliders, ['cc.CircleCollider2D']);
    } finally {
      await cleanup();
    }
  });

  it('qualifies typed Box2D joint creation and endpoint validation', async (t) => {
    if (skipIfDown(t)) return;
    const names = ['__candidate_joint_body_a__', '__candidate_joint_body_b__'];
    const cleanup = async () => {
      const removed = await postTool('executeJavascript', {
        context: 'scene',
        code: `const sc=cc.director.getScene();for(const name of ${JSON.stringify(names)}){const n=sc.getChildByName(name);if(n){n.removeFromParent();n.destroy();}}return ${JSON.stringify(names)}.every(name=>!sc.getChildByName(name));`,
      });
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      assert.equal(removed.body.result, true);
      const snapshot = await postTool('executeJavascript', { context: 'editor', code: `await Editor.Message.request('scene','snapshot');return true;` });
      assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
    };
    await cleanup();
    try {
      const first = await postTool('physics2dCreateBody', { backend: 'box2d', name: names[0] });
      const second = await postTool('physics2dCreateBody', { backend: 'box2d', name: names[1] });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(second.status, 200, JSON.stringify(second.body));
      const bodyReference = first.body.reference;
      const connectedBodyReference = second.body.reference;
      const builtin = await postExpectedErrorTool('physics2dCreateJoint', {
        backend: 'builtin', bodyReference, connectedBodyReference,
      }, 'candidate.physics2dCreateJoint.negative.v1');
      assert.equal(builtin.status, 422, JSON.stringify(builtin.body));
      assert.equal(builtin.body.code, 'UNSUPPORTED_BACKEND');
      const joint = await postTool('physics2dCreateJoint', {
        backend: 'box2d', joint: 'distance', bodyReference, connectedBodyReference,
      });
      assert.equal(joint.status, 200, JSON.stringify(joint.body));
      assert.equal(joint.body.jointType, 'cc.DistanceJoint2D');
      assert.equal(joint.body.jointReference.type, 'cc.DistanceJoint2D');
      const topology = await getJson(`/tools/physics2dTopologyAudit?reference%5Bid%5D=${encodeURIComponent(bodyReference.id)}`);
      assert.equal(topology.status, 200, JSON.stringify(topology.body));
      assert.equal(topology.body.valid, true);
      assert.deepEqual(topology.body.nodes[0].joints, ['cc.DistanceJoint2D']);
    } finally {
      await cleanup();
    }
  });

  it('probes runtime lifecycle transport and rejects unavailable preview sessions', async (t) => {
    if (skipIfDown(t)) return;
    const targetId = `candidate-preview-${Date.now()}`;
    const unsupported = await postExpectedErrorTool('runtimeSessionLifecycle', {
      operation: 'attach', targetKind: 'browser-preview', targetId,
    }, 'candidate.runtimeSessionLifecycle.negative.v1');
    assert.equal(unsupported.status, 422, JSON.stringify(unsupported.body));
    assert.equal(unsupported.body.code, 'UNSUPPORTED_RUNTIME_TRANSPORT');

    const unavailable = await postExpectedErrorTool('runtimeSessionLifecycle', {
      operation: 'attach', targetKind: 'game-view', targetId,
    }, 'candidate.runtimeSessionLifecycle.negative.v1');
    assert.equal(unavailable.status, 409, JSON.stringify(unavailable.body));
    assert.equal(unavailable.body.code, 'RUNTIME_NOT_READY');
  });
  it('qualifies bounded build output audit and scene script health scan', async (t) => {
    if (skipIfDown(t)) return;
    const tasks = await postTool('buildManage', { operation: 'tasks_info', limit: 20 });
    assert.equal(tasks.status, 200, JSON.stringify(tasks.body));
    const terminalTask = tasks.body.tasks.find((task) => ['success', 'succeeded', 'done', 'finished'].includes(String(task.state).toLowerCase()));
    assert.ok(terminalTask?.id, 'a completed Creator build task is required for buildTaskWait qualification');
    const waited = await getJson(`/tools/buildTaskWait?taskId=${encodeURIComponent(terminalTask.id)}&timeoutMs=0`);
    assert.equal(waited.status, 200, JSON.stringify(waited.body));
    assert.equal(waited.body.completed, true);
    assert.equal(waited.body.timedOut, false);
    assert.equal(String(waited.body.task.id), String(terminalTask.id));
    const missingTask = await getExpectedErrorJson('/tools/buildTaskWait?taskId=__missing_candidate_build_task__', 'candidate.buildTaskWait.negative.v1');
    assert.equal(missingTask.status, 404);
    assert.equal(missingTask.body.code, 'TARGET_NOT_FOUND');
    const output = await getJson('/tools/buildOutputAudit?artifactPath=.&expectedFiles%5B0%5D%5Bpath%5D=package.json');
    assert.equal(output.status, 200, JSON.stringify(output.body));
    assert.equal(output.body.valid, true);
    assert.equal(output.body.checkedFiles, 1);
    assert.equal(output.body.files[0].path, 'package.json');

    const outputNegative = await getJson('/tools/buildOutputAudit?artifactPath=.&expectedFiles%5B0%5D%5Bpath%5D=__missing_candidate_build_file__');
    assert.equal(outputNegative.status, 200);
    assert.equal(outputNegative.body.valid, false);
    assert.deepEqual(outputNegative.body.issues, ['missing:__missing_candidate_build_file__']);

    const healthScan = await getJson('/tools/sceneScriptHealthScan?limit=32');
    assert.equal(healthScan.status, 200, JSON.stringify(healthScan.body));
    assert.equal(typeof healthScan.body.total, 'number');
    assert.equal(healthScan.body.truncated, false);
    assert.ok(Array.isArray(healthScan.body.findings));
    const healthNegative = await getJson('/tools/sceneScriptHealthScan?limit=0');
    assert.equal(healthNegative.status, 400);
  });
});
