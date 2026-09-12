'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { AssetTools } = requireDist('utcp/tools/asset-tools.js');

function installEditor(request, getProject) {
  const previous = global.Editor;
  global.Editor = { Message: { request }, Profile: { getProject } };
  return () => previous === undefined ? delete global.Editor : (global.Editor = previous);
}

describe('assetCompressionConfigure', () => {
  it('validates an effective platform preset, persists it, and hashes generated importer outputs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-compress-'));
    const source = path.join(root, 'image.png');
    const generated = path.join(root, 'image.json');
    fs.writeFileSync(source, 'source-image');
    fs.writeFileSync(generated, 'generated-output');
    const asset = { uuid: 'image-id', type: 'cc.ImageAsset', importer: 'image', file: source, library: { '.json': generated } };
    let meta = { uuid: asset.uuid, importer: 'image', userData: {}, subMetas: {}, files: [] };
    let reimports = 0;
    const restore = installEditor(async (_service, message, ...args) => {
      if (message === 'query-asset-info') return asset;
      if (message === 'query-asset-meta') return meta;
      if (message === 'save-asset-meta') { meta = JSON.parse(args[1]); return asset; }
      if (message === 'reimport-asset') { reimports++; return true; }
      throw new Error(`Unexpected message ${message}`);
    }, async (_name, _key, protocol) => protocol === 'default' ? {
      defaultConfig: { default: { name: 'Opaque', options: { web: { png: { quality: 80 }, astc_8x8: { quality: 'medium' } } } } },
    } : null);

    try {
      const result = await new AssetTools().assetCompressionConfigure({ reference: { id: asset.uuid }, presetId: 'default', platform: 'web' });
      assert.equal(result.changed, true);
      assert.equal(result.previousPresetId, null);
      assert.equal(meta.userData.presetId, 'default');
      assert.deepEqual(result.formats, [{ format: 'astc_8x8', quality: 'medium' }, { format: 'png', quality: 80 }]);
      assert.equal(result.sourceSha256.length, 64);
      assert.equal(result.generatedOutputs[0].bytes, Buffer.byteLength('generated-output'));
      assert.equal(result.generatedOutputs[0].sha256.length, 64);
      assert.equal(result.buildArtifactVerified, false);
      assert.equal(reimports, 1);
    } finally {
      restore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a preset without formats for the requested platform before mutation', async () => {
    const asset = { uuid: 'image-id', type: 'cc.ImageAsset', importer: 'image' };
    const calls = [];
    const restore = installEditor(async (_service, message) => {
      calls.push(message);
      if (message === 'query-asset-info') return asset;
      throw new Error(`Unexpected message ${message}`);
    }, async () => ({ defaultConfig: { default: { options: { web: { png: { quality: 80 } } } } } }));
    try {
      await assert.rejects(
        new AssetTools().assetCompressionConfigure({ reference: { id: asset.uuid }, presetId: 'default', platform: 'android' }),
        (error) => error.code === 'UNSUPPORTED_OPERATION' && error.status === 422,
      );
      assert.deepEqual(calls, ['query-asset-info']);
    } finally {
      restore();
    }
  });
});
