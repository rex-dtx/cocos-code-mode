'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { AdvancedCapabilityTools } = requireDist('utcp/tools/advanced-capability-tools.js');
const { PrefabJsonTools } = requireDist('utcp/tools/prefab-json-tools.js');
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
  it('inspects serialized prefab structure with bounded component and UUID summaries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-inspect-'));
    const file = path.join(root, 'fixture.prefab');
    fs.writeFileSync(file, JSON.stringify({ __type__: 'cc.Node', child: { __type__: 'cc.Sprite', asset: '11111111-1111-1111-1111-111111111111@sub' } }));
    const previous = global.Editor;
    const row = { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
    global.Editor = { Message: { request: async (service, message) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const result = await new (requireDist('utcp/tools/prefab-json-tools.js').PrefabJsonTools)().prefabInspect({ reference: { id: 'prefab-asset', type: 'cc.Prefab' } });
      assert.equal(result.uuid, 'prefab-asset');
      assert.equal(result.totalEntries, 2);
      assert.deepEqual(result.components, ['cc.Node', 'cc.Sprite']);
      assert.deepEqual(result.references, ['11111111-1111-1111-1111-111111111111']);
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
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
      if (service === 'scene' && message === 'query-node') return { uuid: 'instance', __prefab__: { value: { uuid: 'prefab-asset' } }, name: { value: 'Fixture' } };
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
  it('instantiates prefab with linked identity and cleans failed read-back', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-instantiate-'));
    const file = path.join(root, 'fixture.prefab');
    fs.writeFileSync(file, '{}');
    const previous = global.Editor;
    let removed = false;
    const row = { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
    global.Editor = { Message: { request: async (service, message, argument) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      if (service === 'scene' && message === 'query-node-tree') return { uuid: 'root' };
      if (service === 'scene' && message === 'create-node') return 'instance';
      if (service === 'scene' && message === 'snapshot') return true;
      if (service === 'scene' && message === 'query-node') return argument === 'instance' ? { uuid: 'instance', __prefab__: { value: { uuid: 'prefab-asset' } } } : { uuid: 'root' };
      if (service === 'scene' && message === 'remove-node') { removed = true; return true; }
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const result = await new AdvancedCapabilityTools().prefabInstantiate({ reference: { id: 'prefab-asset', type: 'cc.Prefab' }, name: 'FixtureInstance' });
      assert.equal(result.persisted, true);
      assert.equal(result.reference.id, 'instance');
      assert.equal(result.source.id, 'prefab-asset');
      assert.equal(removed, false);
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts Creator 3.7 query-node prefab identity fields', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-3x7-'));
    const file = path.join(root, 'fixture.prefab');
    fs.writeFileSync(file, '{}');
    const previous = global.Editor;
    const row = { uuid: 'prefab-3x7', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
    global.Editor = { Message: { request: async (service, message) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      if (service === 'scene' && message === 'query-node-tree') return { uuid: 'scene-root' };
      if (service === 'scene' && message === 'create-node') return 'instance-3x7';
      if (service === 'scene' && message === 'snapshot') return true;
      if (service === 'scene' && message === 'query-node') return { uuid: { value: 'instance-3x7' }, prefab: { assetUuid: { value: 'prefab-3x7' } }, name: { value: 'Instance' } };
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const result = await new AdvancedCapabilityTools().prefabInstantiate({ reference: { id: row.uuid, type: 'cc.Prefab' } });
      assert.equal(result.persisted, true);
      assert.deepEqual(result.reference, { id: 'instance-3x7', type: 'cc.Node' });
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('round-trips the native reference-image lifecycle without claiming unsupported configuration', async () => {
    const previous = global.Editor;
    const requests = [];
    global.Editor = { Message: { request: async (service, message, payload) => {
      requests.push([service, message, payload]);
      if (service !== 'scene') throw new Error(`unexpected ${service}:${message}`);
      if (message === 'set-reference-image') return true;
      if (message === 'query-reference-image') return { id: 'image-asset', path: 'db://assets/reference.png' };
      if (message === 'list-reference-images') return [{ id: 'image-asset', path: 'db://assets/reference.png' }];
      if (message === 'clear-reference-image') return true;
      throw new Error(`unexpected scene message ${message}`);
    } } };
    try {
      const tools = new AdvancedCapabilityTools();
      const set = await tools.referenceImageManage({ operation: 'set', imagePath: 'db://assets/reference.png' });
      assert.deepEqual(set, { operation: 'set', supported: true, persisted: true, imagePath: 'db://assets/reference.png', reference: null, images: undefined, result: true });
      const inspect = await tools.referenceImageManage({ operation: 'inspect' });
      assert.equal(inspect.supported, true);
      assert.equal(inspect.persisted, true);
      const listed = await tools.referenceImageManage({ operation: 'list' });
      assert.deepEqual(listed.images, [{ id: 'image-asset', path: 'db://assets/reference.png' }]);
      const clear = await tools.referenceImageManage({ operation: 'clear' });
      assert.equal(clear.persisted, true);
      assert.deepEqual(requests.map(([, message]) => message), ['set-reference-image', 'query-reference-image', 'list-reference-images', 'clear-reference-image']);
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
    }
  });

  it('switches and refreshes the bounded reference-image lifecycle', async () => {
    const previous = global.Editor;
    let current = null;
    global.Editor = { Message: { request: async (service, message, payload) => {
      if (service !== 'scene') throw new Error(`unexpected ${service}:${message}`);
      if (message === 'set-reference-image') { current = { id: payload.uuid ?? 'image-asset', path: payload.path }; return true; }
      if (message === 'query-reference-image') return current;
      if (message === 'clear-reference-image') { current = null; return true; }
      throw new Error(`unexpected scene message ${message}`);
    } } };
    try {
      const tools = new AdvancedCapabilityTools();
      const switched = await tools.referenceImageManage({ operation: 'switch', imagePath: 'db://assets/reference-2.png', reference: { id: 'image-2', type: 'cc.ImageAsset' } });
      assert.equal(switched.persisted, true);
      assert.equal(switched.imagePath, 'db://assets/reference-2.png');
      const refreshed = await tools.referenceImageManage({ operation: 'refresh' });
      assert.equal(refreshed.persisted, true);
      assert.equal(refreshed.imagePath, 'db://assets/reference-2.png');
      await tools.referenceImageManage({ operation: 'clear' });
      await assert.rejects(() => tools.referenceImageManage({ operation: 'refresh' }), error => error.code === 'TARGET_NOT_FOUND');
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
    }
  });

  it('uses only the qualified project-profile fallback for persistent reference-image lifecycle', async () => {
    const previous = global.Editor;
    const profile = {};
    const row = { uuid: 'image-asset', url: 'db://assets/reference.png', type: 'cc.Texture2D', file: __filename };
    global.Editor = {
      Message: { request: async (service, message) => {
        if (service === 'scene' && message === 'query-current-scene') return { uuid: 'scene-asset' };
        throw new Error(`unsupported ${service}:${message}`);
      } },
      Profile: {
        getProject: async () => ({ ...profile }),
        setProject: async (_packageName, _key, value) => { Object.keys(profile).forEach((key) => delete profile[key]); Object.assign(profile, value); },
      },
    };
    const originalRequest = global.Editor.Message.request;
    global.Editor.Message.request = async (service, message, payload) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      return originalRequest(service, message, payload);
    };
    try {
      const tools = new AdvancedCapabilityTools();
      const set = await tools.referenceImageManage({ operation: 'set', imagePath: row.url });
      assert.equal(set.persisted, true);
      assert.deepEqual(set.reference, { id: row.uuid, type: 'cc.ImageAsset' });
      const inspect = await tools.referenceImageManage({ operation: 'inspect' });
      assert.equal(inspect.imagePath, row.url);
      assert.deepEqual(inspect.reference, { id: row.uuid, type: 'cc.ImageAsset' });
      const listed = await tools.referenceImageManage({ operation: 'list' });
      assert.equal(listed.persisted, true);
      assert.equal(listed.images.length, 1);
      const clear = await tools.referenceImageManage({ operation: 'clear' });
      assert.equal(clear.persisted, true);
      assert.deepEqual(profile, {});
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
    }
  });

  it('rejects selective prefab revert when Creator exposes only full restore', async () => {
    await assert.rejects(
      () => new AdvancedCapabilityTools().prefabRevertOverrides({ reference: { id: 'instance', type: 'cc.Node' }, paths: ['position'] }),
      (error) => error.code === 'UNSUPPORTED_SELECTIVE_REVERT' && error.status === 422,
    );
  });
  it('restores a prefab instance through native full restore and reads back identity', async () => {
    const previous = global.Editor;
    const requests = [];
    global.Editor = { Message: { request: async (service, message, payload) => {
      requests.push([service, message, payload]);
      if (service === 'scene' && message === 'query-node') return { uuid: 'instance', __prefab__: { value: { uuid: 'prefab-asset' } } };
      if (service === 'asset-db' && message === 'query-asset-info') return { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file: __filename };
      if (service === 'scene' && message === 'restore-prefab') return true;
      if (service === 'scene' && message === 'snapshot') return true;
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const result = await new AdvancedCapabilityTools().prefabRestore({ reference: { id: 'instance', type: 'cc.Node' } });
      assert.equal(result.operation, 'revert');
      assert.equal(result.persisted, true);
      assert.ok(requests.some(([, message]) => message === 'restore-prefab'));
      assert.deepEqual(result.reference, { id: 'instance', type: 'cc.Node' });
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
    }
  });
  it('creates prefab from node, updates linked instance, and inspects overrides', async () => {
    const previous = global.Editor;
    const file = __filename;
    const requests = [];
    global.Editor = { Message: { request: async (service, message, payload) => {
      requests.push([service, message, payload]);
      if (service === 'scene' && message === 'query-node' && payload === 'node') return { uuid: 'node', __prefab__: { value: { uuid: 'prefab-asset', instance: { propertyOverrides: [{ path: 'name', value: 'Changed' }] } } } };
      if (service === 'scene' && message === 'execute-scene-script') return 'created-prefab';
      if (service === 'asset-db' && message === 'query-asset-info') return { uuid: 'created-prefab', url: 'db://assets/created.prefab', type: 'cc.Prefab', file };
      if (service === 'scene' && message === 'snapshot') return true;
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const tools = new AdvancedCapabilityTools();
      const created = await tools.prefabCreateFromNode({ reference: { id: 'node', type: 'cc.Node' }, assetPath: 'db://assets/created.prefab' });
      assert.equal(created.persisted, true);
      assert.equal(created.asset.id, 'created-prefab');
      global.Editor.Message.request = async (service, message, payload) => {
        if (service === 'scene' && message === 'query-node') return { uuid: 'node', __prefab__: { value: { uuid: 'prefab-asset' } } };
        if (service === 'asset-db' && message === 'query-asset-info') return { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
        if (service === 'scene' && message === 'execute-scene-script') return null;
        if (service === 'scene' && message === 'snapshot') return true;
        throw new Error(`unexpected ${service}:${message}`);
      };
      await assert.doesNotReject(() => tools.prefabUpdate({ reference: { id: 'node', type: 'cc.Node' } }));
      const inspected = await tools.prefabInstanceInspect({ reference: { id: 'node', type: 'cc.Node' } });
      assert.equal(inspected.isPrefabInstance, true);
      assert.equal(inspected.prefabReference.id, 'prefab-asset');
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
    }
  });
  it('returns prefab info and validates serialized dependencies with read-back', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-prefab-validate-'));
    const file = path.join(root, 'fixture.prefab');
    fs.writeFileSync(file, JSON.stringify({ __type__: 'cc.Node', child: { __type__: 'cc.Sprite', asset: '11111111-1111-1111-1111-111111111111@sub' } }));
    const previous = global.Editor;
    const row = { uuid: 'prefab-asset', url: 'db://assets/fixture.prefab', type: 'cc.Prefab', file };
    global.Editor = { Message: { request: async (service, message) => {
      if (service === 'asset-db' && message === 'query-asset-info') return row;
      if (service === 'asset-db' && message === 'query-assets') return [row];
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    try {
      const tools = new PrefabJsonTools();
      const info = await tools.prefabInfo({ reference: { id: 'prefab-asset', type: 'cc.Prefab' } });
      assert.equal(info.totalEntries, 2);
      const validation = await tools.prefabValidate({ reference: { id: 'prefab-asset', type: 'cc.Prefab' } });
      assert.equal(validation.valid, false);
      assert.deepEqual(validation.missingReferences, [{ id: '11111111-1111-1111-1111-111111111111' }]);
      assert.equal(validation.issues[0].code, 'MISSING_REFERENCE');
    } finally {
      if (previous === undefined) delete global.Editor; else global.Editor = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });


  it('registers all bounded prefab, tilemap, UI, and ergonomics routes', () => {
    const names = new Set(ToolRegistry.getTools().map(({ tool }) => tool.name));
    for (const name of [
      'prefabInfo', 'prefabValidate',
      'referenceImageManage', 'prefabOverrideDiff', 'prefabReferenceAudit', 'sceneReferenceValidate',
      'prefabInstantiate', 'prefabCreateFromNode', 'prefabUpdate', 'prefabInstanceInspect', 'prefabApplyOverrides', 'prefabRevertOverrides', 'prefabRestore', 'tilemapInspect',
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
  it('publishes expansion integration guidance in agent-visible descriptions', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'prefabOverrideDiff');
    assert.ok(metadata);
    assert.match(metadata.tool.description, /Integration guidance — Use when:/);
    assert.match(metadata.tool.description, /Preconditions:/);
    assert.match(metadata.tool.description, /verify the returned postcondition/);
  });
});
