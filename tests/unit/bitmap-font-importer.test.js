'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { BitmapFontImporter } = requireDist('utcp/utils/asset-importers/bitmap-font-importer.js');

const ASSET = { uuid: 'font-uuid', url: 'db://internal/default_fonts/builtin-bitmap/OpenSans-Bold.fnt', type: 'cc.BitmapFont', importer: 'bitmap-font' };

function meta(overrides) {
  return {
    importer: 'bitmap-font',
    userData: {
      fontSize: 20,
      textureUuid: 'c903a495-69a9-4bb1-8266-000000000000',
      _fntConfig: { fontDefDictionary: { 32: {}, 65: {}, 66: {} } },
      ...overrides,
    },
  };
}

function install(request) {
  const previous = global.Editor;
  global.Editor = { Message: { request } };
  return () => { if (previous === undefined) delete global.Editor; else global.Editor = previous; };
}

describe('bitmap-font importer handler', () => {
  it('publishes every derived bitmap-font field as read-only', async () => {
    const calls = [];
    const restore = install(async (service, message, id) => {
      calls.push([service, message, id]);
      assert.equal(service, 'asset-db');
      assert.equal(message, 'query-asset-meta');
      return meta();
    });
    try {
      const properties = await new BitmapFontImporter().getProperties(ASSET);
      assert.equal(properties.fontSize.value, 20);
      assert.equal(properties.fontSize.type, 'Integer');
      assert.equal(properties.fontSize.readonly, true);
      assert.equal(properties.textureUuid.value, 'c903a495-69a9-4bb1-8266-000000000000');
      assert.equal(properties.textureUuid.readonly, true);
      assert.equal(properties.glyphCount.value, 3);
      assert.equal(properties.glyphCount.readonly, true);
      assert.deepEqual(calls, [['asset-db', 'query-asset-meta', 'font-uuid']]);
    } finally {
      restore();
    }
  });

  it('refuses every write path because the importer derives all fields from the .fnt source', async () => {
    const calls = [];
    const restore = install(async (...args) => { calls.push(args); return meta(); });
    try {
      const importer = new BitmapFontImporter();
      assert.equal(await importer.setProperty(ASSET, 'textureUuid', 'other-uuid'), false);
      assert.equal(await importer.setProperty(ASSET, 'fontSize', 32), false);
      assert.equal(await importer.setProperty(ASSET, 'fontSize', 0), false);
      assert.equal(await importer.setProperty(ASSET, 'fontSize', 513), false);
      assert.equal(await importer.setProperty(ASSET, 'fontSize', 20.5), false);
      assert.equal(await importer.setProperty(ASSET, 'fontSize', '20'), false);
      assert.deepEqual(calls, []);
    } finally {
      restore();
    }
  });
});
