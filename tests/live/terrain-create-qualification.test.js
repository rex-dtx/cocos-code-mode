'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  getJson,
  postTool,
  postExpectedErrorTool,
  repeatTestcase,
  healthCheck,
} = require('../helpers/utcp-client');

describe('live: terrain creation qualification', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('creates, inspects, rejects malformed input, and cleans terrain fixtures', { timeout: 240_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('TERRAIN-CREATE-01', async ({ iteration }) => {
      const sceneBefore = await getJson('/tools/sceneGetInfo');
      assert.equal(sceneBefore.status, 200, JSON.stringify(sceneBefore.body));
      assert.equal(sceneBefore.body.dirty, false);
      let parentReference;
      let createdCanvas = false;
      const existingCanvas = await getJson('/tools/findNodes?componentType=cc.Canvas&maxResults=1');
      assert.equal(existingCanvas.status, 200, JSON.stringify(existingCanvas.body));
      if (existingCanvas.body.nodes.length) {
        parentReference = existingCanvas.body.nodes[0].reference;
      } else {
        const createdRoot = await postTool('createUiNode', {
          uiType: 'Widget',
          name: `__ccb3x_terrain_canvas_${process.pid}_${iteration}__`,
        });
        assert.equal(createdRoot.status, 200, JSON.stringify(createdRoot.body));
        parentReference = createdRoot.body.reference;
        const addedCanvas = await postTool('nodeComponentManage', {
          operation: 'add',
          reference: parentReference,
          componentType: 'cc.Canvas',
        });
        assert.equal(addedCanvas.status, 200, JSON.stringify(addedCanvas.body));
        createdCanvas = true;
      }
      const suffix = `${process.pid}_${iteration}`;
      const name = `__ccb3x_terrain_qualification_${suffix}__`;
      const assetPath = `db://assets/${name}.terrain`;
      let assetReference;
      let nodeReference;

      try {
        const created = await postTool('terrainCreate', {
          assetPath,
          name,
          parentReference,
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.equal(created.body.verified, true);
        assetReference = created.body.asset.reference;
        nodeReference = created.body.node;
        assert.match(assetReference.id, /^[0-9a-f-]{36}$/i);
        assert.equal(nodeReference.type, 'cc.Node');
        assert.equal(created.body.component.type, 'cc.Terrain');

        let inspected = await getJson(`/tools/terrainInspect?reference%5Bid%5D=${encodeURIComponent(nodeReference.id)}&reference%5Btype%5D=cc.Node`);
        assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
        assert.equal(inspected.body.count, 1);
        assert.equal(inspected.body.terrains[0].name, name);
        assert.equal(inspected.body.terrains[0].node.id.value, nodeReference.id);


        const malformed = await postExpectedErrorTool('terrainCreate', {
          assetPath: 'db://assets/../unsafe.terrain',
          name: '__unsafe_terrain__',
        }, 'candidate.terrainCreate.negative.v1');
        assert.equal(malformed.status, 400, JSON.stringify(malformed.body));
      } finally {
        if (nodeReference) {
          const deletedNode = await postTool('nodeOperate', { operation: 'delete', reference: nodeReference });
          assert.equal(deletedNode.status, 200, JSON.stringify(deletedNode.body));
        }
        if (assetReference) {
          const deletedAsset = await postTool('assetOperate', { operation: 'delete', reference: assetReference });
          assert.equal(deletedAsset.status, 200, JSON.stringify(deletedAsset.body));
        }
        if (createdCanvas && parentReference) {
          const deletedCanvas = await postTool('nodeOperate', { operation: 'delete', reference: parentReference });
          assert.equal(deletedCanvas.status, 200, JSON.stringify(deletedCanvas.body));
        }
      }

      const after = await getJson(`/tools/findNodes?name=${encodeURIComponent(name)}&maxResults=1`);
      assert.equal(after.status, 200, JSON.stringify(after.body));
      assert.equal(after.body.nodes.length, 0);
      const assetAfter = await getJson(`/tools/assetQuery?pattern=${encodeURIComponent(assetPath)}`);
      assert.equal(assetAfter.status, 200, JSON.stringify(assetAfter.body));
      assert.equal(assetAfter.body.total, 0);
    });
  });
});
