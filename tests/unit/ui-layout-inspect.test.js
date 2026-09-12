'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { UiTools } = requireDist('utcp/tools/ui-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');
const { methods } = requireDist('scene.js');
const { buildUiLayoutInspectGeometry } = requireDist('ui-layout-inspect.js');

const matrix = (x = 0, y = 0) => ({
  m00: 1, m01: 0, m02: 0, m03: 0, m04: 0, m05: 1, m06: 0, m07: 0,
  m08: 0, m09: 0, m10: 1, m11: 0, m12: x, m13: y, m14: 0, m15: 1,
});

const dump = (id, name, children = [], x = 0) => ({
  uuid: { value: id, type: 'String' },
  name,
  children,
  position: { value: { x, y: 0, z: 0 } },
  active: { value: true },
  __comps__: [{ type: 'cc.UITransform', value: { contentSize: { width: 20, height: 10 }, anchorPoint: { x: 0.5, y: 0.5 } } }],
});

const installEditor = (tree, dumps, options = {}) => {
  const liveNodes = new Map([...dumps].map(([id, value]) => [id, {
    uuid: id,
    children: [],
    get worldMatrix() { return matrix(value.position?.value?.x ?? 0, value.position?.value?.y ?? 0); },
    getComponent(type) { return value.__comps__?.find((component) => component.type === type)?.value ?? null; },
  }]));
  global.cc = { director: { getScene: () => options.liveScene ?? { uuid: 'scene', children: [...liveNodes.values()] } } };
  global.Editor = { Message: { request: async (module, message, payload) => {
    assert.equal(module, 'scene');
    if (message === 'query-node-tree') {
      if (options.treeError) throw options.treeError;
      if (!payload || payload === tree.uuid || options.treeMismatch) return tree;
      const subtree = dumps.get(payload);
      return subtree ? { uuid: payload, children: subtree.children } : null;
    }
    if (message === 'query-node') {
      if (options.nodeError) throw options.nodeError;
      return dumps.get(payload) ?? null;
    }
    if (message === 'execute-scene-script' && payload.method === 'uiLayoutInspectGeometry') {
      return options.geometryResponse ?? methods.uiLayoutInspectGeometry(payload.args[0]);
    }
    if (message === 'set-property') {
      const node = dumps.get(payload.uuid);
      if (payload.path === 'position' || payload.path === 'active') node[payload.path] = payload.dump;
      else if (payload.path.endsWith('._contentSize')) node.__comps__[0].value.contentSize = payload.dump.value;
      else if (payload.path.endsWith('._anchorPoint')) node.__comps__[0].value.anchorPoint = payload.dump.value;
      else throw new Error(`unexpected property ${payload.path}`);
      return true;
    }
    if (message === 'snapshot' || message === 'snapshot-abort') return true;
    throw new Error(`unexpected scene message ${message}`);
  } } };
};

afterEach(() => { delete global.Editor; delete global.cc; });

describe('uiLayoutInspect', () => {
  it('traverses in Creator child order and computes normalized layout values', async () => {
    const tree = { uuid: 'root', children: [{ uuid: 'first' }, { uuid: 'second' }] };
    const dumps = new Map([
      ['root', dump('root', 'Root', [...tree.children].reverse())],
      ['first', dump('first', 'First', [], 10)],
      ['second', dump('second', 'Second', [], 30)],
    ]);
    installEditor(tree, dumps);
    const result = await new UiTools().uiLayoutInspect({ reference: { id: 'root', type: 'cc.Node' } });
    assert.deepEqual(result.nodes.map((node) => node.reference.id), ['root', 'first', 'second']);
    assert.deepEqual(result.nodes[2].worldRect, { x: 20, y: -5, width: 20, height: 10 });
    assert.equal(result.truncated, false);
    const untyped = await new UiTools().uiLayoutInspect({ reference: { id: 'root' } });
    assert.deepEqual(untyped, result);
  });

  it('is cycle-safe and reports truncation only when an unvisited child remains', async () => {
    const tree = { uuid: 'root', children: [{ uuid: 'child' }] };
    const dumps = new Map([
      ['root', dump('root', 'Root', [{ uuid: 'child' }])],
      ['child', dump('child', 'Child', [{ uuid: 'root' }])],
    ]);
    installEditor(tree, dumps);
    const complete = await new UiTools().uiLayoutInspect({ reference: { id: 'root', type: 'cc.Node' }, maxNodes: 2 });
    assert.deepEqual(complete.nodes.map((node) => node.reference.id), ['root', 'child']);
    assert.equal(complete.truncated, false);

    const wideTree = { uuid: 'root', children: [{ uuid: 'a' }, { uuid: 'b' }] };
    const wideDumps = new Map([
      ['root', dump('root', 'Root', wideTree.children)],
      ['a', dump('a', 'A')],
      ['b', dump('b', 'B')],
    ]);
    installEditor(wideTree, wideDumps);
    const bounded = await new UiTools().uiLayoutInspect({ reference: { id: 'root', type: 'cc.Node' }, maxNodes: 2 });
    assert.equal(bounded.truncated, true);
  });

  it('rejects malformed arguments and maps Creator failures to typed errors', async () => {
    await assert.rejects(() => new UiTools().uiLayoutInspect({ maxNodes: 129 }), (error) => error instanceof ToolError && error.status === 400);
    await assert.rejects(() => new UiTools().uiLayoutInspect({ reference: { id: 'root', type: 'cc.Component' } }), (error) => error instanceof ToolError && error.status === 400);

    installEditor({ uuid: 'root', children: [] }, new Map(), { treeError: new Error('scene unavailable') });
    await assert.rejects(() => new UiTools().uiLayoutInspect({}), (error) => error instanceof ToolError && error.status === 502 && error.code === 'UI_LAYOUT_QUERY_FAILED');

    installEditor({ uuid: 'root', children: [] }, new Map());
    await assert.rejects(() => new UiTools().uiLayoutInspect({}), (error) => error instanceof ToolError && error.status === 404);

    installEditor({ uuid: 'root', children: [{ value: {} }] }, new Map([['root', dump('root', 'Root', [{ value: {} }])]]));
    await assert.rejects(() => new UiTools().uiLayoutInspect({}), (error) => error instanceof ToolError && error.status === 502 && error.code === 'UI_LAYOUT_INVALID_RESPONSE');
  });

  it('uses a selected child world matrix including transformed ancestors and only its own anchored corners', async () => {
    const selectedDump = dump('child', 'Child', [{ uuid: 'large' }], 5);
    selectedDump.position.value = { x: 5, y: 4, z: 7 };
    selectedDump.active.value = false;
    const large = { uuid: 'large', children: [], getComponent: () => ({ contentSize: { width: 10000, height: 10000 }, anchorPoint: { x: 0, y: 0 } }), worldMatrix: matrix() };
    const child = {
      uuid: 'child', children: [large],
      // Parent T(100,50) R(90deg) S(-2,3), child local translation (5,4).
      worldMatrix: { ...matrix(88, 40), m00: 0, m01: -2, m04: -3, m05: 0 },
      getComponent: () => ({
        contentSize: { width: 20, height: 10 }, anchorPoint: { x: 0.5, y: 0.5 },
        getBoundingBoxToWorld() { throw new Error('Descendant-inclusive bounds must not be read'); },
      }),
    };
    const parent = { uuid: 'parent', children: [child], worldMatrix: { ...matrix(100, 50), m00: 0, m01: -2, m04: -3, m05: 0 } };
    installEditor({ uuid: 'child', children: [{ uuid: 'large' }] }, new Map([['child', selectedDump]]), { liveScene: { uuid: 'scene', children: [parent] } });
    const result = await new UiTools().uiLayoutInspect({ reference: { id: 'child' }, maxNodes: 1 });
    assert.deepEqual(result.nodes[0].worldRect, { x: 73, y: 20, width: 30, height: 40 });
    assert.deepEqual(result.nodes[0].position, { x: 5, y: 4, z: 7 });
    assert.equal(result.nodes[0].active, false);
    assert.equal(result.truncated, true);
  });

  it('keeps non-UI nodes in inventory with truthful null geometry', async () => {
    const root = dump('root', 'Root', [{ uuid: 'ui' }]);
    root.__comps__ = [];
    installEditor({ uuid: 'root', children: [{ uuid: 'ui' }] }, new Map([['root', root], ['ui', dump('ui', 'Ui')]]));
    const result = await new UiTools().uiLayoutInspect({});
    assert.deepEqual(result.nodes.map((entry) => entry.reference.id), ['root', 'ui']);
    assert.deepEqual([result.nodes[0].size, result.nodes[0].anchor, result.nodes[0].worldRect], [null, null, null]);
    assert.deepEqual(result.nodes[1].size, { width: 20, height: 10 });
  });

  it('fails closed on missing or malformed live transforms instead of inventing identity geometry', async () => {
    const base = { uuid: 'root', getComponent: () => ({ contentSize: { width: 20, height: 10 }, anchorPoint: { x: 0.5, y: 0.5 } }) };
    for (const worldMatrix of [undefined, { ...matrix(), m00: NaN }, { m00: 1, m05: 1 }, { ...matrix(), m12: Infinity }]) {
      installEditor({ uuid: 'root' }, new Map([['root', dump('root', 'Root')]]), { liveScene: { ...base, worldMatrix } });
      await assert.rejects(new UiTools().uiLayoutInspect({}), (error) => error.code === 'UI_LAYOUT_GEOMETRY_UNAVAILABLE' && error.status === 502);
    }
    installEditor({ uuid: 'root' }, new Map([['root', dump('root', 'Root')]]), {
      liveScene: { ...base, worldMatrix: matrix(), getComponent: () => ({ contentSize: { width: 20, height: 10 } }) },
    });
    await assert.rejects(new UiTools().uiLayoutInspect({}), (error) => error.code === 'UI_LAYOUT_GEOMETRY_UNAVAILABLE');
  });

  it('rejects mismatched hierarchy, geometry identity and incomplete geometry responses', async () => {
    const dumps = new Map([['root', dump('root', 'Root')]]);
    installEditor({ uuid: 'other' }, dumps, { treeMismatch: true });
    await assert.rejects(new UiTools().uiLayoutInspect({ reference: { id: 'root' } }), (error) => error.code === 'UI_LAYOUT_INVALID_RESPONSE');
    for (const geometryResponse of [
      { nodes: [] },
      { nodes: [{ id: 'other', size: null, anchor: null, worldRect: null }] },
      { nodes: [{ id: 'root', size: null, anchor: null, worldRect: { x: 0, y: 0, width: 1, height: 1 } }] },
    ]) {
      installEditor({ uuid: 'root' }, dumps, { geometryResponse });
      await assert.rejects(new UiTools().uiLayoutInspect({}), (error) => error.code === 'UI_LAYOUT_INVALID_RESPONSE');
    }
  });

  it('enforces both public traversal and private geometry input bounds', async () => {
    for (const maxNodes of [0, -1, 1.5, 129, NaN, '2']) {
      await assert.rejects(new UiTools().uiLayoutInspect({ maxNodes }), (error) => error.code === 'INVALID_ARGUMENT');
      await assert.rejects(new UiTools().uiLayoutValidate({ reference: { id: 'root' }, maxNodes }), (error) => error.code === 'INVALID_ARGUMENT');
    }
    for (const reference of [{ id: '' }, { id: ' ' }, { id: 'x'.repeat(257) }, { id: 'root', type: null }, { id: 'root', extra: true }]) {
      await assert.rejects(new UiTools().uiLayoutInspect({ reference }), (error) => error.code === 'INVALID_ARGUMENT');
    }
    for (const request of [{ nodeIds: [] }, { nodeIds: ['a', 'a'] }, { nodeIds: Array.from({ length: 129 }, (_, i) => String(i)) }, { nodeIds: ['a'], script: 'ignored?' }]) {
      assert.equal(buildUiLayoutInspectGeometry({}, request).error.code, 'INVALID_ARGUMENT');
    }
    const children = Array.from({ length: 128 }, (_, i) => ({ uuid: `n${i}` }));
    const dumps = new Map([['root', dump('root', 'Root', children)], ...children.map(({ uuid }) => [uuid, dump(uuid, uuid)])]);
    installEditor({ uuid: 'root', children }, dumps);
    const result = await new UiTools().uiLayoutInspect({ maxNodes: 128 });
    assert.equal(result.nodes.length, 128);
    assert.equal(result.nodes[127].reference.id, 'n126');
    assert.equal(result.truncated, true);
  });

  it('returns live read-back through actual Apply, Align and legacy Validate consumers', async () => {
    const a = dump('a', undefined, [], 10);
    const b = dump('b', 'B', [], 40);
    a.parent = b.parent = { value: { uuid: 'parent' } };
    const dumps = new Map([['a', a], ['b', b]]);
    installEditor({ uuid: 'a', children: [] }, dumps);
    const tools = new UiTools();
    const applied = await tools.uiLayoutApply({ reference: { id: 'a' }, position: { x: 20, y: 3, z: 7 }, size: { width: 30, height: 10 }, anchor: { x: 0, y: 0 }, active: false });
    assert.deepEqual(applied.layout.worldRect, { x: 20, y: 3, width: 30, height: 10 });
    assert.deepEqual(applied.layout.position, { x: 20, y: 3, z: 7 });
    assert.equal(applied.layout.name, 'a');
    assert.equal(applied.layout.active, false);
    const aligned = await tools.uiLayoutAlign({ references: [{ id: 'a' }, { id: 'b' }], operation: 'align', axis: 'horizontal', edge: 'left' });
    assert.deepEqual(aligned.layouts.map((entry) => entry.worldRect.x), [20, 20]);
    assert.deepEqual(aligned.layouts.map((entry) => entry.position.x), [20, 30]);
    assert.deepEqual(await tools.uiLayoutValidate({ reference: { id: 'a' } }), { valid: true, issues: [], checkedNodes: 1 });
    a.__comps__[0].value.contentSize.width = -30;
    assert.deepEqual(await tools.uiLayoutValidate({ reference: { id: 'a' } }), { valid: false, issues: ['a: negative layout size'], checkedNodes: 1 });
    a.__comps__ = [];
    assert.deepEqual(await tools.uiLayoutValidate({ reference: { id: 'a' } }), { valid: false, issues: ['a: missing cc.UITransform'], checkedNodes: 1 });
  });

  it('rolls back partial uiLayoutApply writes and aborts the pending snapshot', async () => {
    const node = dump('root', 'Root', [], 4);
    const dumps = new Map([['root', node]]);
    const requests = [];
    installEditor({ uuid: 'root', children: [] }, dumps);
    const originalRequest = global.Editor.Message.request;
    global.Editor.Message.request = async (module, message, payload) => {
      requests.push({ message, payload });
      if (message === 'set-property' && payload.path.endsWith('._contentSize')) throw new Error('refused');
      return originalRequest(module, message, payload);
    };
    await assert.rejects(
      new UiTools().uiLayoutApply({ reference: { id: 'root' }, position: { x: 20 }, size: { width: 30, height: 10 } }),
      (error) => error.code === 'MUTATION_FAILED' && error.status === 500,
    );
    assert.deepEqual(node.position.value, { x: 4, y: 0, z: 0 });
    assert.ok(requests.some(({ message }) => message === 'snapshot-abort'));
    assert.ok(!requests.some(({ message }) => message === 'snapshot'));
  });
});
