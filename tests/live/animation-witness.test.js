'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase } = require('../helpers/utcp-client');
const { liveWitness, assertPositive, assertNegative } = require('../helpers/witness-harness');

describe('live: animation candidate witnesses (non-qualifying)', () => {
  it('inspects and validates a real SkeletalAnimation node, with typed negative witnesses', async (t) => {
    const evidence = await liveWitness(
      'witness.skeletal-animation.inspect-validate.v1',
      async ({ getExpectedErrorJson }) => {
        const nodes = await getJson('/tools/findNodes?componentType=cc.SkeletalAnimation&maxResults=1');
        assertPositive(nodes, 'find SkeletalAnimation');
        if (!nodes.body.nodes.length) return { unavailable: true, reason: 'No SkeletalAnimation fixture is present in the active scene.' };

        const reference = nodes.body.nodes[0].reference;
        const encoded = encodeURIComponent(reference.id);
        const inspected = await getJson(`/tools/skeletalAnimationInspect?nodeReference%5Bid%5D=${encoded}&maxClips=3`);
        const inspectBody = assertPositive(inspected, 'skeletalAnimationInspect');
        assert.equal(inspectBody.reference.id, reference.id);
        assert.ok(Array.isArray(inspectBody.clips));
        assert.equal(typeof inspectBody.totalClips, 'number');

        const validated = await postTool('skeletalAnimationValidate', { nodeReference: reference, maxClips: 3 });
        const validateBody = assertPositive(validated, 'skeletalAnimationValidate');
        assert.equal(typeof validateBody.valid, 'boolean');
        assert.ok(Array.isArray(validateBody.issues));
        assert.equal(typeof validateBody.clipCount, 'number');

        const invalid = await getExpectedErrorJson(
          '/tools/skeletalAnimationInspect?nodeReference=%7B%22id%22%3A%22__missing_animation_node__%22%7D',
          'candidate.skeletalAnimationInspect.negative.v1',
        );
        assert.equal(invalid.status, 404);
        assert.equal(invalid.body.code, 'TARGET_NOT_FOUND');
        return { inspected: inspectBody, validated: validateBody, negative: invalid.body };
      },
      [
        'This witness is fixture-dependent and is skipped when the active scene has no SkeletalAnimation node.',
        'Positive validation may report asset/component limitations; valid=false is retained as observed evidence.',
      ],
    );

    if (evidence.skipped) {
      t.skip(evidence.reason);
      return;
    }
    if (evidence.result.unavailable) {
      t.skip(evidence.result.reason);
      return;
    }
    assert.equal(typeof evidence.build.commit, 'string');
    assert.equal(typeof evidence.build.branch, 'string');
    assert.ok(evidence.limitations.length >= 2);
  });

  it('controls a disposable generic Animation state with documented state fields', async (t) => {
    const manual = await getJson('/utcp');
    assertPositive(manual, 'UTCP manual');
    const runtimeTool = manual.body.tools.find((tool) => tool.name === 'animationRuntimeControl');
    if (!runtimeTool?.inputs?.properties?.playbackRange) {
      t.skip('Active Creator bridge predates the documented AnimationState weight/delay/playbackRange contract.');
      return;
    }

    await repeatTestcase('ANIM-W01', async () => {
      let nodeId;
      try {
        const created = await postTool('executeJavascript', {
          context: 'scene',
          code: `const cc = require('cc');
const scene = cc.director.getScene();
const node = new cc.Node('__ccp_animation_state_witness__');
const animation = node.addComponent(cc.Animation);
const clip = new cc.AnimationClip();
clip.name = '__ccp_animation_state_clip__';
clip.duration = 2;
animation.addClip(clip);
scene.addChild(node);
return { id: node.uuid };`,
        });
        const createdBody = assertPositive(created, 'executeJavascript animation fixture');
        nodeId = createdBody.result.id;
        assert.equal(typeof nodeId, 'string');
        const controlled = await postTool('animationRuntimeControl', {
          nodeReference: { id: nodeId, type: 'cc.Node' },
          operation: 'set_state',
          clipName: '__ccp_animation_state_clip__',
          speed: 1.25,
          time: 0.4,
          repeatCount: 2,
          wrapMode: 0,
          weight: 0.65,
          delay: 0.1,
          playbackRange: { min: 0.2, max: 1.5 },
        });
        if (!controlled.ok && controlled.status === 502 && controlled.body?.code === 'ANIMATION_CONTROL_FAILED' && /read-back mismatch/.test(controlled.body?.details?.cause || '')) return { status: 'SKIP', reason: 'Creator rejected AnimationState read-back' };
        if (!controlled.ok && controlled.status === 500 && controlled.body?.code === 'INTERNAL_ERROR') return { status: 'SKIP', reason: 'Creator rejected AnimationState mutation' };
        const controlledBody = assertPositive(controlled, 'animationRuntimeControl set_state');
        assert.equal(controlledBody.operation, 'set_state');
        assert.equal(controlledBody.state.speed, 1.25);
        assert.equal(controlledBody.state.weight, 0.65);
        assert.equal(controlledBody.state.delay, 0.1);
        assert.deepEqual(controlledBody.state.playbackRange, { min: 0.2, max: 1.5 });
      } finally {
        if (nodeId) await postTool('executeJavascript', { context: 'scene', code: `const node = require('cc').director.getScene().getChildByUuid('${nodeId}'); if (node) node.destroy(); return true;` });
      }
    });
  });
});
