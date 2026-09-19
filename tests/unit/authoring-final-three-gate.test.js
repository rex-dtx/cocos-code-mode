'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { SceneTools } = requireDist('utcp/tools/scene-tools.js');
const { AssetTools } = requireDist('utcp/tools/asset-tools.js');
const { UiTools } = requireDist('utcp/tools/ui-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
const { assetQueryMemo } = requireDist('utcp/utils/memo-cache.js');
const previousEditor = global.Editor;
afterEach(() => { assetQueryMemo.invalidate(); if (previousEditor === undefined) delete global.Editor; else global.Editor = previousEditor; });
function metadata(name) { const entry = ToolRegistry.getTools().find(({ tool }) => tool.name === name); assert.ok(entry, `registered route ${name}`); return entry.tool; }

describe('authoring final three gate evidence', () => {
  it('proves node transform direct route, exact writes, snapshot, and read-back', async () => {
    const calls = []; let node = { uuid: 'node-1', position: { value: { x: 1, y: 2, z: 3 } }, eulerAngles: { value: { x: 0, y: 0, z: 0 } }, scale: { value: { x: 1, y: 1, z: 1 } }, active: { value: true } };
    global.Editor = { Message: { request: async (_service, message, payload) => { calls.push([message, payload]); if (message === 'query-node') return node; if (message === 'set-property') { node[payload.path] = payload.dump; return true; } if (message === 'snapshot') return true; throw new Error(`unexpected ${message}`); } } };
    const result = await new SceneTools().nodeSetTransform({ reference: { id: 'node-1' }, position: { x: 8, y: 9, z: 10 }, rotation: { x: 11, y: 12, z: 13 }, scale: { x: 2, y: 3, z: 4 }, active: false });
    assert.deepEqual(result, { updated: true, reference: { id: 'node-1', type: 'cc.Node' } });
    assert.deepEqual(calls.map(([message]) => message), ['query-node', 'set-property', 'set-property', 'set-property', 'set-property', 'snapshot', 'query-node']);
    assert.deepEqual(calls.slice(1, 5).map(([, payload]) => [payload.path, payload.dump.type]), [['position', 'cc.Vec3'], ['eulerAngles', 'cc.Vec3'], ['scale', 'cc.Vec3'], ['active', 'Boolean']]);
    const transformRoute = ToolRegistry.getTools().find(({ tool }) => tool.name === 'nodeSetTransform');
    assert.equal(transformRoute.tool.tool_call_template.http_method, 'POST');
    assert.deepEqual(transformRoute.tool.tags, ['scene', 'node', 'transform', 'position', 'rotation', 'scale', 'active', 'set']);
  });

  it('proves scene asset-usage-analyze graph-v4 reachability, bounds, and dynamic caveat', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb3x-final-usage-')); const scene = path.join(root, 'main.scene');
    fs.writeFileSync(scene, JSON.stringify({ __uuid__: '11111111-1111-1111-1111-111111111111' }));
    const rows = [
      { uuid: '00000000-0000-0000-0000-000000000001', url: 'db://assets/main.scene', type: 'cc.SceneAsset', file: scene, isDirectory: false },
      { uuid: '11111111-1111-1111-1111-111111111111', url: 'db://assets/used.png', type: 'cc.ImageAsset', isDirectory: false },
      { uuid: '22222222-2222-2222-2222-222222222222', url: 'db://assets/unused.png', type: 'cc.ImageAsset', isDirectory: false },
    ];
    try {
      global.Editor = { Message: { request: async (service, message, options) => { assert.equal(service, 'asset-db'); assert.equal(message, 'query-assets'); assert.deepEqual(options, { pattern: 'db://assets/**' }); return rows; } } };
      const result = await new AssetTools().assetUsageAnalyze({ assetPath: 'db://assets', maxAssets: 10, maxGraphAssets: 10 });
      assert.equal(result.graphVersion, 'v4'); assert.equal(result.complete, true); assert.equal(result.graphEdges, 1);
      assert.deepEqual(result.candidates.map((item) => item.uuid), ['22222222-2222-2222-2222-222222222222']);
      assert.equal(result.referenceEvidence.find((item) => item.uuid === '11111111-1111-1111-1111-111111111111').status, 'root-reachable');
      assert.match(result.dynamicLoadCaveat, /dynamic runtime addressables/);
      const tool = metadata('assetUsageAnalyze'); assert.equal(ToolRegistry.getTools().find(({ tool: candidate }) => candidate.name === 'assetUsageAnalyze').tool.tool_call_template.http_method, 'GET'); assert.equal(tool.outputs.properties.graphVersion.const, 'v4'); assert.equal(tool.outputs.properties.candidates.maxItems, 128);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('proves parent mutation postcondition failure and bounded rollback route', async () => {
    let queries = 0; global.Editor = { Message: { request: async (_service, message, payload) => {
      if (message === 'query-node') { queries++; return queries === 1 ? { uuid: payload, parent: { value: { uuid: 'old-parent' } } } : { uuid: payload, parent: { value: { uuid: 'wrong-parent' } } }; }
      if (message === 'set-parent' || message === 'snapshot') return true; throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(new SceneTools().nodeOperate({ operation: 'move', reference: { id: 'child' }, newParentReference: { id: 'parent' } }), (error) => error.code === 'NODE_MOVE_UNCONFIRMED' && error.status === 502);
    const operateRoute = ToolRegistry.getTools().find(({ tool }) => tool.name === 'nodeOperate');
    assert.equal(operateRoute.tool.tool_call_template.http_method, 'POST');
    assert.match(operateRoute.tool.description, /Node operations/);

    const node = { uuid: { value: 'root' }, name: 'Root', children: [], position: { value: { x: 4, y: 0, z: 0 } }, active: { value: true }, __comps__: [{ type: 'cc.UITransform', value: { contentSize: { width: 20, height: 10 }, anchorPoint: { x: 0.5, y: 0.5 } } }] };
    const requests = []; global.Editor.Message.request = async (module, message, payload) => { requests.push(message); if (message === 'query-node') return node; if (message === 'set-property' && payload.path.endsWith('._contentSize')) throw new Error('refused'); if (message === 'set-property') { node[payload.path] = payload.dump; return true; } if (message === 'snapshot-abort') return true; return true; };
    await assert.rejects(new UiTools().uiLayoutApply({ reference: { id: 'root' }, position: { x: 20 }, size: { width: 30, height: 10 } }), (error) => error.code === 'MUTATION_FAILED' && error.status === 500);
    assert.deepEqual(node.position.value, { x: 4, y: 0, z: 0 }); assert.ok(requests.includes('snapshot-abort')); assert.ok(!requests.includes('snapshot'));
  });
});
