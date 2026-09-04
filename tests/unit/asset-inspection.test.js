'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { ToolsUtils } = requireDist('utcp/utils/tools-utils.js');
const { ImporterManager } = requireDist('utcp/utils/asset-importers/importer-manager.js');
const { SceneImporter } = requireDist('utcp/utils/asset-importers/scene-importer.js');

const ASSET = {
  uuid: 'scene-asset-uuid',
  type: 'cc.SceneAsset',
  name: 'Main',
  url: 'db://assets/Main.scene',
  importer: 'scene-test',
};

function installEditor(handler) {
  const previous = global.Editor;
  global.Editor = { Message: { request: handler } };
  return () => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  };
}

describe('asset inspection', () => {
  it('returns identity properties when importer metadata inspection fails', async () => {
    ImporterManager.getInstance().registerImporter({
      name: ASSET.importer,
      async getProperties() { throw new Error('metadata unavailable'); },
      async setProperty() { return false; },
    });

    const restore = installEditor(async (channel, message) => {
      if (channel === 'scene') return null;
      if (channel === 'asset-db' && message === 'query-asset-info') return ASSET;
      throw new Error(`Unexpected request: ${channel}.${message}`);
    });
    const previousWarn = console.warn;
    console.warn = () => {};

    try {
      const result = await ToolsUtils.inspectInstance(ASSET.uuid);
      assert.equal(result.type, 'cc.SceneAsset');
      assert.equal(result.props.uuid.value, ASSET.uuid);
      assert.equal(result.props.importer.value, ASSET.importer);
      assert.equal(result.props.uuid.readonly, true);
    } finally {
      console.warn = previousWarn;
      restore();
    }
  });

  it('SceneImporter exposes scene metadata when Cocos returns it', async () => {
    const restore = installEditor(async (channel, message, uuid) => {
      assert.equal(channel, 'asset-db');
      assert.equal(message, 'query-asset-meta');
      assert.equal(uuid, ASSET.uuid);
      return { imported: true, userData: { asyncLoadAssets: true } };
    });

    try {
      const props = await new SceneImporter().getProperties(ASSET);
      assert.equal(props.uuid.value, ASSET.uuid);
      assert.equal(props.importer.value, 'scene');
      assert.equal(props.imported.value, true);
      assert.equal(props.asyncLoadAssets.value, true);
    } finally {
      restore();
    }
  });
});
