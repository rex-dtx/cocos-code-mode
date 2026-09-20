'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: typed asset importer settings', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('exposes importer schema and persists a verified mutable setting roundtrip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const assets = await getJson('/tools/assetQuery?importer=image&limit=1');
    assert.equal(assets.ok, true, JSON.stringify(assets.body));
    const source = assets.body.assets?.[0];
    assert.equal(typeof source?.uuid, 'string');
    const extension = /(\.[A-Za-z0-9]+)$/.exec(source.url)?.[1] ?? '.png';
    const assetPath = `db://assets/__ccb3x_import_settings_${Date.now()}${extension}`;
    let reference;
    try {
      const copied = await postTool('assetOperate', {
        operation: 'copy',
        reference: { id: source.uuid, type: source.type },
        targetAssetPath: assetPath,
      });
      assert.equal(copied.ok, true, JSON.stringify(copied.body));
      reference = copied.body.reference;

      const before = await getJson(`/tools/assetImportSettingsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
      assert.equal(before.ok, true, JSON.stringify(before.body));
      assert.equal(before.body.importer, 'image');
      assert.equal(before.body.schema.importer, 'image');
      assert.ok(before.body.schema.mutablePaths.includes('flipVertical'));
      const original = before.body.settings.flipVertical;
      assert.equal(typeof original, 'boolean');

      const changed = await postTool('assetImportSettingsSet', {
        reference,
        path: 'flipVertical',
        value: !original,
      });
      assert.equal(changed.ok, true, JSON.stringify(changed.body));
      assert.equal(changed.body.previous, original);
      assert.equal(changed.body.readBack, !original);
      assert.equal(changed.body.result.settings.flipVertical, changed.body.readBack);

      const restored = await postTool('assetImportSettingsSet', { reference, path: 'flipVertical', value: original });
      assert.equal(restored.ok, true, JSON.stringify(restored.body));
      assert.equal(restored.body.readBack, original);

      const compression = await postTool('assetCompressionConfigure', {
        reference,
        presetId: 'default',
        platform: 'web',
      });
      assert.equal(compression.ok, true, JSON.stringify(compression.body));
      assert.equal(compression.body.presetId, 'default');
      assert.equal(compression.body.platform, 'web');
      assert.ok(compression.body.formats.some(({ format }) => format === 'png'));
      assert.match(compression.body.sourceSha256, /^[a-f0-9]{64}$/);
      assert.ok(compression.body.generatedOutputs.length > 0);
      assert.ok(compression.body.generatedOutputs.every(({ bytes, sha256 }) => bytes > 0 && /^[a-f0-9]{64}$/.test(sha256)));
    } finally {
      if (reference?.id) await postTool('assetOperate', { operation: 'delete', reference });
    }
  });

  it('serves the derived bitmap-font importer fields as a read-only typed audit', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const assets = await getJson('/tools/assetQuery?importer=bitmap-font&limit=1');
    assert.equal(assets.ok, true, JSON.stringify(assets.body));
    const source = assets.body.assets?.[0];
    assert.equal(typeof source?.uuid, 'string', 'a bitmap font fixture is available');
    const assetPath = `db://assets/__ccb3x_bitmap_font_settings_${Date.now()}.fnt`;
    let reference;
    try {
      const copied = await postTool('assetOperate', {
        operation: 'copy',
        reference: { id: source.uuid, type: source.type },
        targetAssetPath: assetPath,
      });
      assert.equal(copied.ok, true, JSON.stringify(copied.body));
      reference = copied.body.reference;

      const before = await getJson(`/tools/assetImportSettingsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
      assert.equal(before.ok, true, JSON.stringify(before.body));
      assert.equal(before.body.importer, 'bitmap-font');
      assert.equal(before.body.schema.importer, 'bitmap-font');
      const original = before.body.settings.fontSize;
      assert.equal(Number.isInteger(original), true);
      // The three published fields are the derived font size, the emitted atlas and the
      // rasterised glyph count; none of them is a supported write target.
      assert.equal(Number.isInteger(before.body.settings.glyphCount), true);
      assert.equal(typeof before.body.settings.textureUuid, 'string');

      // Every bitmap-font field is derived from the .fnt source, so a write must never
      // persist: the corrected artifact refuses it as read-only, and the earlier artifact
      // accepted save-asset-meta and then reverted the value on reimport.
      const attempted = await postTool('assetImportSettingsSet', { reference, path: 'fontSize', value: original + 2 });
      assert.ok([400, 422, 502].includes(attempted.status), JSON.stringify(attempted.body));
      const after = await getJson(`/tools/assetImportSettingsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
      assert.equal(after.body.settings.fontSize, original);
      const other = await postTool('assetImportSettingsSet', { reference, path: 'textureUuid', value: 'other-uuid' });
      assert.ok([400, 422, 502].includes(other.status), JSON.stringify(other.body));
    } finally {
      if (reference?.id) await postTool('assetOperate', { operation: 'delete', reference });
    }
  });
});
