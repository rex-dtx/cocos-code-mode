'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

const TMX = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="1" height="1" tilewidth="32" tileheight="32" infinite="0">
 <layer id="1" name="Ground" width="1" height="1"><data encoding="csv">0</data></layer>
 <objectgroup id="2" name="Objects"><object id="1" name="Spawn" x="0" y="0" width="16" height="16"/></objectgroup>
</map>
`;

describe('live: tilemap candidate qualification witnesses', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('imports, inspects, validates, and round-trips bounded TMX edits', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const source = path.join(os.tmpdir(), `ccb3x-tilemap-${process.pid}.tmx`);
    fs.writeFileSync(source, TMX, 'utf8');
    let reference;
    try {
      const imported = await postTool('assetBatchImport', {
        items: [{ sourceFilesystemPath: source, targetAssetPath: 'db://assets/__ccb3x_candidate_tilemap__.tmx' }],
      });
      assert.equal(imported.status, 200, JSON.stringify(imported.body));
      assert.equal(imported.body.succeeded, 1);
      reference = imported.body.outcomes[0].reference;
      assert.equal(reference.type, 'cc.TiledMapAsset');

      const inspect = await getJson(`/tools/tilemapInspect?reference%5Bid%5D=${reference.id}`);
      assert.equal(inspect.status, 200, JSON.stringify(inspect.body));
      assert.equal(inspect.body.count, 2);
      assert.equal(inspect.body.layers[0].name, 'Ground');
      assert.equal(inspect.body.objectGroups[0].objects[0].name, 'Spawn');

      const valid = await getJson(`/tools/tilemapValidate?reference%5Bid%5D=${reference.id}`);
      assert.equal(valid.status, 200, JSON.stringify(valid.body));
      assert.equal(valid.body.valid, true);
      assert.deepEqual(valid.body.missingReferences, []);

      const layer = await postTool('tilemapLayerEdit', { reference, path: 'layers.Ground.opacity', value: 0.5 });
      assert.equal(layer.status, 200, JSON.stringify(layer.body));
      assert.equal(layer.body.persisted, true);
      assert.equal(layer.body.readBack.opacity, 0.5);
      const object = await postTool('tilemapObjectEdit', { reference, path: 'objects.Spawn.x', value: 12 });
      assert.equal(object.status, 200, JSON.stringify(object.body));
      assert.equal(object.body.persisted, true);
      assert.equal(object.body.readBack.x, 12);

      const wrongType = await getJson('/tools/tilemapInspect?reference%5Bid%5D=f8befe54-5f06-4454-b61b-eb99915fc8f8');
      assert.equal(wrongType.status, 422);
      assert.equal(wrongType.body.code, 'TYPE_MISMATCH');
    } finally {
      if (reference) {
        const cleanup = await postTool('assetBatchOperate', { items: [{ operation: 'delete', reference }] });
        assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
        assert.equal(cleanup.body.succeeded, 1);
      }
      fs.rmSync(source, { force: true });
    }
  });
});
