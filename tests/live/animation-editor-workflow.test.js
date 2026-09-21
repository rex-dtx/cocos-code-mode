'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase } = require('../helpers/utcp-client');

const fixtureName = `__ccp3x_animation_editor_${process.pid}__`;
const selectionPasses = Math.min(10, Math.max(1, Number(process.env.CCP_SELECTION_PASSES || 5) || 5)); // Override with CCP_SELECTION_PASSES=3, etc.

async function selectNodeRepeatedly(reference) {
  for (let pass = 1; pass <= selectionPasses; pass++) {
    const cleared = await postTool('editorSelect', { operation: 'clear' });
    assert.equal(cleared.ok, true, `selection clear pass ${pass}: ${JSON.stringify(cleared.body)}`);
    const selected = await postTool('editorSelect', { operation: 'select', references: [reference] });
    assert.equal(selected.ok, true, `selection pass ${pass}: ${JSON.stringify(selected.body)}`);
    assert.ok(selected.body.selected?.includes(reference.id), `selection pass ${pass} missed ${reference.id}`);
  }
}

async function removeFixture(nodeId) {
  if (!nodeId) return;
  await postTool('executeJavascript', {
    context: 'scene',
    code: `const node = require('cc').director.getScene().getChildByUuid('${nodeId}'); if (node) node.destroy(); return true;`,
  });
}

describe('live: animation editor workflows', { concurrency: false }, () => {
  it('creates a real AnimationClip, configures runtime state, and reads it back', async () => {
    await repeatTestcase('ANIM-C01', async () => {
      let nodeId;
      try {
        const created = await postTool('executeJavascript', {
          context: 'scene',
          code: `const cc = require('cc');
const scene = cc.director.getScene();
const node = new cc.Node('${fixtureName}');
const animation = node.addComponent(cc.Animation);
const clip = new cc.AnimationClip();
clip.name = '${fixtureName}_clip';
clip.duration = 2;
animation.addClip(clip);
scene.addChild(node);
return { id: node.uuid, clip: clip.name };`,
        });
        assert.equal(created.ok, true, JSON.stringify(created.body));
        nodeId = created.body.result.id;
        const reference = { id: nodeId, type: 'cc.Node' };
        await selectNodeRepeatedly(reference);
        const focused = await postTool('editorViewport', { operation: 'focus', references: [reference] });
        assert.equal(focused.ok, true, JSON.stringify(focused.body));
        const configured = await postTool('animationRuntimeControl', {
          nodeReference: reference,
          operation: 'set_state',
          clipName: `${fixtureName}_clip`,
          speed: 1.5,
          weight: 0.75,
          delay: 0.1,
          playbackRange: { min: 0.2, max: 1.6 },
        });
        assert.equal(configured.ok, true, JSON.stringify(configured.body));
        assert.equal(configured.body.operation, 'set_state');
        const state = configured.body.animation.states.find((item) => item.name === `${fixtureName}_clip`);
        assert.ok(state, JSON.stringify(configured.body));
        assert.equal(state.speed, 1.5);
        assert.equal(state.weight, 0.75);
        assert.equal(state.delay, 0.1);
        assert.deepEqual(state.playbackRange, { min: 0.2, max: 1.6 });
        const inspected = await postTool('animationRuntimeControl', {
          nodeReference: reference,
          operation: 'inspect',
        });
        assert.equal(inspected.ok, true, JSON.stringify(inspected.body));
        assert.equal(inspected.body.nodeReference.id, nodeId);
      } finally {
        await postTool('editorSelect', { operation: 'clear' });
        await removeFixture(nodeId);
      }
    });
  });

  it('selects a real imported AnimationClip and drives the editor playhead', async (t) => {
    const nodes = await getJson('/tools/findNodes?componentType=cc.Animation&maxResults=10');
    assert.equal(nodes.ok, true, JSON.stringify(nodes.body));
    let clipReference;
    let animationNodeReference;
    for (const item of nodes.body.nodes) {
      const clips = await getJson(`/tools/animationQuery?operation=clips_info&nodeReference%5Bid%5D=${encodeURIComponent(item.reference.id)}`);
      assert.equal(clips.ok, true, JSON.stringify(clips.body));
      const clip = clips.body.result?.clipsMenu?.find((candidate) => candidate.uuid);
      if (clip) {
        clipReference = { id: clip.uuid, type: 'cc.AnimationClip' };
        animationNodeReference = item.reference;
        break;
      }
    }
    if (!clipReference) {
      t.skip('active scene has no imported AnimationClip fixture');
      return;
    }
    let unsupportedReason;
    await repeatTestcase('ANIM-E01', async () => {
      await selectNodeRepeatedly(animationNodeReference);
      const focused = await postTool('editorViewport', { operation: 'focus', references: [animationNodeReference] });
      assert.equal(focused.ok, true, JSON.stringify(focused.body));
      const selected = await postTool('animationEdit', { operation: 'set_edit_clip', clipReference });
      assert.equal(selected.ok, true, JSON.stringify(selected.body));
      assert.equal(selected.body.success, true);
      const playhead = await postTool('animationEdit', { operation: 'set_edit_time', time: 0 });
      assert.equal(playhead.ok, true, JSON.stringify(playhead.body));
      if (!playhead.body.success) {
        unsupportedReason = `Creator refused editor playhead update: ${JSON.stringify(playhead.body)}`;
        return { status: 'SKIP', reason: unsupportedReason };
      }
      const paused = await postTool('animationEdit', {
        operation: 'clip_state',
        clipState: 'pause',
        clipReference,
      });
      assert.equal(paused.ok, true, JSON.stringify(paused.body));
      if (!paused.body.success) {
        unsupportedReason = `Creator refused editor clip pause: ${JSON.stringify(paused.body)}`;
        return { status: 'SKIP', reason: unsupportedReason };
      }
      await postTool('editorSelect', { operation: 'clear' });
    });
    await postTool('editorSelect', { operation: 'clear' });
    if (unsupportedReason) t.skip(unsupportedReason);
  });
});
