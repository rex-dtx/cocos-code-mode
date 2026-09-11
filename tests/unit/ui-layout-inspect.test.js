'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { UiTools } = requireDist('utcp/tools/ui-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

const dump = (id, name, children = [], x = 0) => ({
  uuid: id,
  name,
  children,
  position: { value: { x, y: 0, z: 0 } },
  active: { value: true },
  __comps__: [{ type: 'cc.UITransform', value: { contentSize: { width: 20, height: 10 }, anchorPoint: { x: 0.5, y: 0.5 } } }],
});

const installEditor = (tree, dumps, options = {}) => {
  global.Editor = { Message: { request: async (module, message, payload) => {
    assert.equal(module, 'scene');
    if (message === 'query-node-tree') {
      if (options.treeError) throw options.treeError;
      return tree;
    }
    if (message === 'query-node') {
      if (options.nodeError) throw options.nodeError;
      return dumps.get(payload) ?? null;
    }
    throw new Error(`unexpected scene message ${message}`);
  } } };
};

afterEach(() => { delete global.Editor; });

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
});
