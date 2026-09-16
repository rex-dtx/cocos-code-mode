'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { MaterialTools } = requireDist('utcp/tools/material-tools.js');

describe('materialEdit contract', () => {
  it('rejects missing references before editor mutation', async () => {
    await assert.rejects(
      () => new MaterialTools().materialEdit({ path: 'passes.0.properties.roughness', value: 0.5 }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });

  it('rejects unsafe property paths before editor mutation', async () => {
    await assert.rejects(
      () => new MaterialTools().materialEdit({ reference: { id: 'mat' }, path: 'passes[0].roughness', value: 0.5 }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });

  it('accepts importer read-back when Creator native material query is structurally unchanged', async () => {
    const previous = global.Editor;
    let technique = 0;
    global.Editor = { Message: {
      request: async (service, message) => {
        if (service === 'asset-db' && message === 'query-asset-info') return { uuid: 'mat', importer: 'material', type: 'cc.Material' };
        if (service === 'scene' && message === 'query-material') return { technique: 0, data: [] };
        if (service === 'scene' && message === 'query-all-effects') return [];
        if (service === 'scene' && message === 'apply-material') { technique = 1; return true; }
        throw new Error(`unexpected ${service}:${message}`);
      },
      broadcast: () => undefined,
    } };
    const { ImporterManager } = requireDist('utcp/utils/asset-importers/index.js');
    const manager = ImporterManager.getInstance();
    const originalGetImporter = manager.getImporter.bind(manager);
    manager.getImporter = () => ({
      setProperty: async () => { technique = 1; return true; },
      getProperties: async () => ({ technique: { value: technique } }),
    });
    try {
      const result = await new MaterialTools().materialEdit({ reference: { id: 'mat', type: 'cc.Material' }, path: 'technique', value: 1 });
      assert.equal(result.changed, true);
      assert.equal(result.after, 1);
    } finally {
      manager.getImporter = originalGetImporter;
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });
});
