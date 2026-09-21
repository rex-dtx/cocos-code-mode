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

describe('live: material edit qualification', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('mutates a disposable material with importer read-back and restores it', { timeout: 180_000 }, async (t) => {
    if (!health?.ok) { t.skip(health?.reason || 'bridge unavailable'); return; }

    await repeatTestcase('MATERIAL-EDIT-01', async ({ iteration }) => {
      const assetPath = `db://assets/__ccp3x_material_${process.pid}_${iteration}__.mtl`;
      let reference;
      try {
        const created = await postTool('assetCreate', { assetPath, preset: 'material' });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        reference = created.body.reference;

        const before = await getJson(`/tools/assetImportSettingsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}&reference%5Btype%5D=cc.Material`);
        assert.equal(before.status, 200, JSON.stringify(before.body));
        assert.equal(before.body.settings.technique, 0);

        const changed = await postTool('materialEdit', { reference, path: 'technique', value: 1 });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        assert.equal(changed.body.changed, true);
        assert.equal(changed.body.path, 'technique');
        assert.equal(changed.body.after, 1);

        const readBack = await getJson(`/tools/assetImportSettingsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}&reference%5Btype%5D=cc.Material`);
        assert.equal(readBack.status, 200, JSON.stringify(readBack.body));
        assert.equal(readBack.body.settings.technique, 1);

        const restored = await postTool('materialEdit', { reference, path: 'technique', value: 0 });
        assert.equal(restored.status, 200, JSON.stringify(restored.body));
        assert.equal(restored.body.changed, true);
        assert.equal(restored.body.after, 0);

        const invalid = await postExpectedErrorTool('materialEdit', {
          reference,
          path: 'passes[0].invalid',
          value: true,
        }, 'candidate.materialEdit.negative.v1');
        assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      } finally {
        if (reference) {
          const removed = await postTool('assetOperate', { operation: 'delete', reference });
          assert.equal(removed.status, 200, JSON.stringify(removed.body));
        }
      }

      const after = await getJson(`/tools/assetQuery?pattern=${encodeURIComponent(assetPath)}`);
      assert.equal(after.status, 200, JSON.stringify(after.body));
      assert.equal(after.body.total, 0);
    });
  });
});
