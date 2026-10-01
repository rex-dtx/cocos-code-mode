'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};
const { AssetReadTools } = require('../../source/utcp/tools-2x/asset-read-tools.ts');
// Captured from cc-2x-testbed/assets/textures/common/ui/btn_blue.png.meta (Creator 2.4.15).
// Keep the projection fixture local so this test is usable in a standalone 2x checkout.
const fixtureMeta = {
  ver: '2.3.7', uuid: 'c3ac253f-dc9b-4ea2-8a56-4815608c45e3', importer: 'texture',
  type: 'sprite', wrapMode: 'clamp', filterMode: 'bilinear', premultiplyAlpha: false,
  genMipmaps: false, packable: true, width: 64, height: 32, platformSettings: {},
  subMetas: { btn_blue: { importer: 'sprite-frame', rawTextureUuid: 'c3ac253f-dc9b-4ea2-8a56-4815608c45e3' } },
};
const url = 'db://assets/textures/common/ui/btn_blue.png';

async function withAsset(meta, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp2x-importer-'));
  const file = path.join(dir, 'btn_blue.png');
  fs.writeFileSync(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(`${file}.meta`, JSON.stringify(meta));
  const before = fs.readFileSync(`${file}.meta`);
  const prior = global.Editor;
  const info = { uuid: fixtureMeta.uuid, url, path: file, type: 'texture', isSubAsset: false };
  global.Editor = { assetdb: {
    assetInfo: key => key === url ? info : null,
    assetInfoByUuid: key => key === info.uuid ? info : null,
    uuidToFspath: key => key === info.uuid ? file : null,
  } };
  try { await run(new AssetReadTools(), { file, before, info }); }
  finally { global.Editor = prior; fs.rmSync(dir, { recursive: true, force: true }); }
}

describe('Creator 2.4 texture importer audit', () => {
  it('projects only supported top-level paths and source-derived dimensions with exact identity without mutation', async () => {
    await withAsset(fixtureMeta, async (tool, { file, before, info }) => {
      const audit = await tool.assetImporterAudit({ uuid: info.uuid, url });
      assert.equal(audit.valid, true);
      assert.equal(audit.importer, 'texture');
      assert.deepEqual(audit.settings, {
        type: 'sprite', wrapMode: 'clamp', filterMode: 'bilinear',
        premultiplyAlpha: false, genMipmaps: false, packable: true,
      });
      assert.deepEqual(audit.propertyPaths, Object.keys(audit.settings));
      assert.deepEqual(audit.derived, { width: 64, height: 32 });
      assert.deepEqual(audit.source, { uuid: info.uuid, url, fspath: file, metaPath: `${file}.meta`, metaMtime: fs.statSync(`${file}.meta`).mtimeMs });
      assert.deepEqual(fs.readFileSync(`${file}.meta`), before);
    });
  });
  it('refuses unsupported importers, inconsistent identities and malformed settings', async () => {
    for (const invalid of [
      { importer: 'sprite-frame' }, { uuid: 'different' }, { wrapMode: null },
      { width: -1 }, { ver: '3.8.0' }, { type: 'unsupported' },
    ]) {
      await withAsset({ ...fixtureMeta, ...invalid }, async (tool, { before, file }) => {
        await assert.rejects(tool.assetImporterAudit({ url }), error => error.code === 'INVALID_IMPORTER_META');
        assert.deepEqual(fs.readFileSync(`${file}.meta`), before);
      });
    }
    await withAsset(fixtureMeta, async tool => {
      await assert.rejects(tool.assetImporterAudit({ url, uuid: 'different' }), error => error.code === 'INVALID_ASSET_REFERENCE');
      await assert.rejects(tool.assetImporterAudit({}), error => error.code === 'INVALID_ASSET_REFERENCE');
      await assert.rejects(tool.assetImporterAudit(null), error => error.code === 'INVALID_ASSET_REFERENCE');
      await assert.rejects(tool.assetImporterAudit({ url: 1 }), error => error.code === 'INVALID_ASSET_REFERENCE');
    });
  });
});
