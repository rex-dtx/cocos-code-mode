'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

/** Live integration qualification: public Spine controls against a real loaded asset; the fixture is cloned to avoid mutating the source node. */
const selectionPasses = Math.min(10, Math.max(1, Number(process.env.CCP_SELECTION_PASSES || 5) || 5));

async function selectNodeRepeatedly(reference) {
  for (let pass = 1; pass <= selectionPasses; pass++) {
    const cleared = await postTool('editorSelect', { operation: 'clear' });
    assert.equal(cleared.ok, true, `selection clear pass ${pass}: ${JSON.stringify(cleared.body)}`);
    const selected = await postTool('editorSelect', { operation: 'select', references: [reference] });
    assert.equal(selected.ok, true, `selection pass ${pass}: ${JSON.stringify(selected.body)}`);
    assert.ok(selected.body.selected?.includes(reference.id), `selection pass ${pass} missed ${reference.id}`);
  }
}
describe('live: Spine interactive asset workflow', { concurrency: false }, () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('duplicates a loaded Spine node, reads its data, and updates animation properties', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }

    const found = await getJson('/tools/findNodes?componentType=sp.Skeleton&maxResults=1');
    assert.equal(found.ok, true, JSON.stringify(found.body));
    if (!found.body.nodes.length) { t.skip('active scene has no loaded sp.Skeleton source asset'); return; }
    const source = found.body.nodes[0].reference;

    await repeatTestcase('SPINE-C01', async () => {
      const copied = await postTool('nodeClipboard', { operation: 'copy', references: [source] });
      assert.equal(copied.ok, true, JSON.stringify(copied.body));
      const pasted = await postTool('nodeClipboard', {
        operation: 'paste',
        references: [source],
        targetReference: canvas,
        pasteAsChild: true,
        keepWorldTransform: true,
      });
      assert.equal(pasted.ok, true, JSON.stringify(pasted.body));
      const node = pasted.body.references[0];
      assert.notEqual(node.id, source.id);
      await selectNodeRepeatedly(node);
      const focused = await postTool('editorViewport', { operation: 'focus', references: [node] });
      assert.equal(focused.ok, true, JSON.stringify(focused.body));
      try {
        const components = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(node.id)}`);
        assert.equal(components.ok, true, JSON.stringify(components.body));
        const skeleton = components.body.references.find((item) => item.type === 'sp.Skeleton');
        assert.equal(typeof skeleton?.id, 'string');
        const inspected = await postTool('spineRuntimeControl', { nodeReference: node, operation: 'inspect' });
        assert.equal(inspected.ok, true, JSON.stringify(inspected.body));
        assert.equal(inspected.body.nodeReference.id, node.id);
        assert.equal(inspected.body.spine.component, 'Skeleton');
        assert.ok(inspected.body.spine.skin === undefined || typeof inspected.body.spine.skin === 'string');
        assert.ok(inspected.body.spine.animation === undefined || typeof inspected.body.spine.animation === 'string');
        assert.equal(typeof inspected.body.spine.timeScale, 'number');
        assert.ok(Array.isArray(inspected.body.spine.tracks));
        const data = await postTool('sceneBatchGet', {
          entries: [{ target: 'instance', reference: skeleton, fields: ['skeletonData', 'defaultSkin', 'defaultAnimation', 'timeScale'] }],
        });
        assert.equal(data.ok, true, JSON.stringify(data.body));
        assert.ok(data.body.results[0].dump.skeletonData, 'loaded skeletonData must be present');
        const changed = await postTool('spineRuntimeControl', { nodeReference: node, operation: 'set_time_scale', timeScale: 1.5 });
        assert.equal(changed.ok, true, JSON.stringify(changed.body));
        assert.equal(changed.body.spine.timeScale, 1.5);
        const animation = inspected.body.spine.animation;
        if (typeof animation === 'string' && animation.length > 0) {
          const queued = await postTool('spineRuntimeControl', { nodeReference: node, operation: 'queue_animation', trackIndex: 0, clipName: animation, loop: true, delay: 0 });
          assert.equal(queued.ok, true, JSON.stringify(queued.body));
          assert.equal(queued.body.spine.tracks[0].animation, animation);
          assert.equal(queued.body.spine.tracks[0].loop, true);
        }
        const preview = await postTool('previewManage', {
          operation: 'scene_preview',
          imageSize: { width: 640, height: 360 },
          cameraPosition: { x: 640, y: 360, z: 1000 },
          targetPosition: { x: 640, y: 360, z: 0 },
          orthographic: true,
          orthographicSize: 360,
        });
        assert.equal(preview.ok, true, JSON.stringify(preview.body));
        assert.equal(preview.body.type, 'image');
        assert.match(preview.body.mimeType, /^image\//);
      } finally {
        await postTool('editorSelect', { operation: 'clear' });
        const deleted = await postTool('nodeOperate', { operation: 'delete', reference: node });
        assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
      }
    });
  });
});
