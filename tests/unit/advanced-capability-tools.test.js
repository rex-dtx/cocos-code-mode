'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { AdvancedCapabilityTools } = requireDist('utcp/tools/advanced-capability-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

describe('advanced capability tools', () => {
  it('returns stable prefab override identities from serialized source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-diff-'));
    const baseline = path.join(root, 'baseline.prefab');
    const current = path.join(root, 'current.prefab');
    fs.writeFileSync(baseline, JSON.stringify({ nodes: [{ name: 'Root', value: 1 }] }));
    fs.writeFileSync(current, JSON.stringify({ nodes: [{ name: 'Root', value: 2 }] }));
    const previous = global.Editor;
    global.Editor = { Message: { request: async (_service, message, identifier) => {
      const file = identifier === 'baseline' ? baseline : current;
      return { uuid: identifier, url: `db://assets/${identifier}.prefab`, type: 'cc.Prefab', file };
    } } };
    try {
      const result = await new AdvancedCapabilityTools().prefabOverrideDiff({ reference: { id: 'current' }, baselineReference: { id: 'baseline' } });
      assert.equal(result.equal, false);
      assert.equal(result.changes[0].identity, 'nodes.0.value:number');
      assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('inspects and edits imported TMX layers and objects with source read-back', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-tmx-'));
    const file = path.join(root, 'fixture.tmx');
    fs.writeFileSync(file, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<map orientation="orthogonal" width="2" height="2" tilewidth="32" tileheight="32">',
      '  <layer id="1" name="Ground" width="2" height="2" opacity="1"><data encoding="csv">1,0,0,1</data></layer>',
      '  <objectgroup id="2" name="Entities"><object id="7" name="Spawn" x="16" y="16"/></objectgroup>',
      '</map>',
    ].join('\n'));
    const previous = global.Editor;
    const row = { uuid: 'fixture-uuid', url: 'db://assets/fixture.tmx', type: 'cc.TiledMapAsset', file };
    global.Editor = { Message: { request: async (service, message, identifier, content) => {
      if (service !== 'asset-db') throw new Error(`unexpected ${service}:${message}`);
      if (message === 'query-asset-info') return row;
      if (message === 'query-assets') return [row];
      if (message === 'save-asset') { fs.writeFileSync(file, content); return row; }
      if (message === 'reimport-asset') return true;
      throw new Error(`unexpected asset-db message ${message} ${identifier}`);
    } } };
    try {
      const tools = new AdvancedCapabilityTools();
      const inventory = await tools.tilemapInspect({ reference: { id: 'fixture-uuid' }, maxLayers: 4 });
      assert.equal(inventory.layers[0].name, 'Ground');
      assert.equal(inventory.layers[0].tileCount, 4);
      assert.equal(inventory.objectGroups[0].objects[0].id, '7');
      const layer = await tools.tilemapLayerEdit({ reference: { id: 'fixture-uuid' }, path: 'layers.Ground.opacity', value: 0.5 });
      assert.equal(layer.persisted, true);
      const object = await tools.tilemapObjectEdit({ reference: { id: 'fixture-uuid' }, path: 'objects.7.x', value: 24 });
      assert.equal(object.persisted, true);
      assert.match(fs.readFileSync(file, 'utf8'), /opacity="0\.5"/);
      assert.match(fs.readFileSync(file, 'utf8'), /id="7" name="Spawn" x="24"/);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('returns prefab source hashes after a successful override apply', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-apply-'));
    const file = path.join(root, 'fixture.prefab');
    fs.writeFileSync(file, '{"position":0}');
    const previous = global.Editor;
    const row = { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
    global.Editor = { Message: { request: async (service, message) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      if (service === 'scene' && message === 'query-node') return { __prefab__: { value: { uuid: 'prefab-asset' } }, name: { value: 'Fixture' } };
      if (service === 'scene' && message === 'execute-scene-script') { fs.writeFileSync(file, '{"position":7}'); return null; }
      if (service === 'scene' && message === 'snapshot') return true;
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const result = await new AdvancedCapabilityTools().prefabApplyOverrides({ reference: { id: 'instance', type: 'cc.Node' } });
      assert.equal(result.persisted, true);
      assert.equal(result.operation, 'apply');
      assert.notEqual(result.sourceReadBack.beforeSha256, result.sourceReadBack.afterSha256);
      assert.equal(result.sourceReadBack.url, 'db://assets/fixture.prefab');
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects selective prefab revert when Creator exposes only full restore', async () => {
    await assert.rejects(
      () => new AdvancedCapabilityTools().prefabRevertOverrides({ reference: { id: 'instance', type: 'cc.Node' }, paths: ['position'] }),
      (error) => error.code === 'UNSUPPORTED_SELECTIVE_REVERT' && error.status === 422,
    );
  });



  it('registers all bounded prefab, tilemap, UI, and ergonomics routes', () => {
    const names = new Set(ToolRegistry.getTools().map(({ tool }) => tool.name));
    for (const name of [
      'referenceImageManage', 'prefabOverrideDiff', 'prefabReferenceAudit', 'sceneReferenceValidate',
      'prefabInstantiate', 'prefabApplyOverrides', 'prefabRevertOverrides', 'tilemapInspect',
      'tilemapLayerEdit', 'tilemapObjectEdit', 'tilemapValidate', 'spriteAtlasConfigure',
      'uiResponsivePreview', 'previewResolutionSet', 'editorUndoTransactionProbe', 'broadcastObserve',
    ]) assert.ok(names.has(name), name);
  });

  it('returns typed unsupported evidence for unavailable preview IPC', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async () => { throw new Error('unsupported'); } } };
    try {
      await assert.rejects(
        () => new AdvancedCapabilityTools().previewResolutionSet({ width: 800, height: 600 }),
        (error) => error.code === 'UNSUPPORTED_PREVIEW_IPC' && error.status === 422,
      );
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });
});
