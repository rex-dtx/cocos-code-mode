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
  it('publishes the rasterisation size as writable and the importer-owned fields as read-only', async () => {
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
      assert.notEqual(properties.fontSize.readonly, true);
      assert.equal(properties.textureUuid.value, 'c903a495-69a9-4bb1-8266-000000000000');
      assert.equal(properties.textureUuid.readonly, true);
      assert.equal(properties.glyphCount.value, 3);
      assert.equal(properties.glyphCount.readonly, true);
      assert.deepEqual(calls, [['asset-db', 'query-asset-meta', 'font-uuid']]);
    } finally {
      restore();
    }
  });

  it('persists a bounded font size through save-asset-meta keeping the other settings', async () => {
    const calls = [];
    const document = meta();
    const restore = install(async (service, message, id, payload) => {
      calls.push([service, message, id, payload]);
      if (message === 'query-asset-meta') return document;
      if (message === 'save-asset-meta') return true;
      throw new Error(`unexpected ${service}:${message}`);
    });
    try {
      const accepted = await new BitmapFontImporter().setProperty(ASSET, 'fontSize', 32);
      assert.equal(accepted, true);
      const saved = JSON.parse(calls.find((call) => call[1] === 'save-asset-meta')[3]);
      assert.equal(saved.userData.fontSize, 32);
      assert.equal(saved.userData.textureUuid, document.userData.textureUuid);
      assert.deepEqual(saved.userData._fntConfig, document.userData._fntConfig);
    } finally {
      restore();
    }
  });

  it('refuses importer-owned and out-of-range paths without touching the asset meta', async () => {
    const calls = [];
    const restore = install(async (...args) => { calls.push(args); return meta(); });
    try {
      const importer = new BitmapFontImporter();
      assert.equal(await importer.setProperty(ASSET, 'textureUuid', 'other-uuid'), false);
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
