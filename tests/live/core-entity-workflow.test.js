'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, repeatTestcase, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

const fixtureName = `__ccb3x_core_entity_${process.pid}__`;

describe('live: core entity feature workflow', { concurrency: false }, () => {
  it('creates, transforms, toggles, reads, and cleans a Canvas-owned entity', async (t) => {
    const health = await healthCheck();
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }

    await repeatTestcase('CORE-E01', async () => {
      let reference;
      try {
        const created = await postTool('createUiNode', {
          uiType: 'Widget',
          name: `${fixtureName}${Date.now()}`,
          parentReference: canvas,
        });
        assert.equal(created.ok, true, JSON.stringify(created.body));
        reference = created.body.reference;
        assert.equal(typeof reference?.id, 'string');
        const pathResult = await getJson(`/tools/nodeGetPath?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
        assert.equal(pathResult.ok, true, JSON.stringify(pathResult.body));
        assert.match(pathResult.body.path, /Canvas/);

        const transformed = await postTool('nodeBatchSet', {
          entries: [{ reference, propertyPaths: ['position', 'scale', 'active'], values: [{ x: 120, y: -80, z: 0 }, { x: 1.2, y: 0.8, z: 1 }, false] }],
        });
        assert.equal(transformed.ok, true, JSON.stringify(transformed.body));
        const hidden = await postTool('sceneBatchGet', { entries: [{ target: 'instance', reference, fields: ['position', 'scale', 'active'] }] });
        assert.equal(hidden.ok, true, JSON.stringify(hidden.body));
        assert.equal(hidden.body.results[0].dump.active, false);
        assert.deepEqual(hidden.body.results[0].dump.position, { x: 120, y: -80, z: 0 });

        const shown = await postTool('nodeBatchSet', { entries: [{ reference, propertyPaths: ['active'], values: [true] }] });
        assert.equal(shown.ok, true, JSON.stringify(shown.body));
        const visible = await postTool('sceneBatchGet', { entries: [{ target: 'instance', reference, fields: ['active'] }] });
        assert.equal(visible.ok, true, JSON.stringify(visible.body));
        assert.equal(visible.body.results[0].dump.active, true);
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
        if (reference) {
          const deleted = await postTool('nodeOperate', { operation: 'delete', reference });
          assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
        }
      }
    });

    const leaked = await getJson(`/tools/findNodes?name=${encodeURIComponent(fixtureName)}&maxResults=20`);
    assert.equal(leaked.ok, true, JSON.stringify(leaked.body));
    assert.equal(leaked.body.nodes.length, 0, JSON.stringify(leaked.body));
  });
});
