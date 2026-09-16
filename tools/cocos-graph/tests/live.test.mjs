import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { treeToGraph, unwrapLiveSnapshot, validateLiveGraph } from '../src/live.mjs';
import { navigate, resolveNode } from '../src/query.mjs';

describe('live snapshot graph conversion', () => {
  it('preserves live provenance and builds composite parent handles', () => {
    const snapshot = unwrapLiveSnapshot({
      sourceFile: 'assets/demo/main.scene',
      dirty: false,
      tree: {
        children: [{
          reference: { id: 'root-id' },
          name: 'Canvas',
          children: [{ reference: { id: 'child-id' }, name: 'Player', children: [] }],
          components: [{ reference: { id: 'component-id', type: 'cc.Sprite' } }],
        }],
      },
    });
    const graph = treeToGraph(snapshot.tree, { file: snapshot.sourceFile });
    validateLiveGraph(graph);
    assert.equal(graph.nodes[0].source, 'live');
    assert.equal(graph.nodes[1].parent, 'assets/demo/main.scene#root-id');
    assert.equal(graph.comps[0].node, 'assets/demo/main.scene#root-id');
    assert.equal(graph.comps[0].type, 'cc.Sprite');
  });

  it('rejects truncated live trees instead of indexing incomplete structure', () => {
    assert.throws(
      () => treeToGraph({ children: [{ reference: { id: 'root' }, truncated: true }] }, { file: 'assets/demo/main.scene' }),
      /live snapshot is truncated/,
    );
  });

  it('normalizes Windows paths and defaults unknown dirty state', () => {
    const snapshot = unwrapLiveSnapshot({ sourceFile: 'assets\\demo\\main.scene', tree: { children: [] } });
    assert.equal(snapshot.sourceFile, 'assets/demo/main.scene');
    assert.equal(snapshot.dirty, 'unknown');
  });

  it('retains a referenced tree root, its components, and child ancestry', () => {
    const file = 'assets/demo/main.scene';
    const graph = treeToGraph({
      reference: { id: 'scene-root', type: 'cc.Node' },
      name: 'Scene',
      path: '/',
      components: [{ reference: { id: 'root-component', type: 'cc.Canvas' } }],
      children: [{ reference: { id: 'player' }, name: 'Player', children: [] }],
    }, { file });
    assert.equal(resolveNode(graph, { handle: `${file}#scene-root` }).node?.uuid, 'scene-root');
    assert.deepEqual(
      navigate(graph, { handle: `${file}#player`, relation: 'ancestors' }).handles.map((node) => node.uuid),
      ['scene-root'],
    );
    assert.equal(graph.comps.find((component) => component.uuid === 'root-component')?.node, `${file}#scene-root`);
  });

  it('retains a referenced leaf root rather than treating its empty children as an empty scene', () => {
    const graph = treeToGraph({ reference: { id: 'root' }, name: 'Root', children: [] }, { file: 'assets/demo/main.scene' });
    assert.deepEqual(graph.nodes.map((node) => node.uuid), ['root']);
  });

  it('rejects producer truncation reasons even when the omission count is absent', () => {
    for (const truncated of ['maxDepth', 'nodeLimit']) {
      assert.throws(() => treeToGraph({
        children: [{ reference: { id: 'root' }, truncated, children: [] }],
      }, { file: 'assets/demo/main.scene' }), /truncat|omitted/i, truncated);
    }
  });

  it('rejects omitted descendants while permitting an explicitly empty complete tree', () => {
    assert.throws(() => treeToGraph({
      children: [{ reference: { id: 'root' }, children: [{ reference: { id: 'child' }, childrenOmitted: 1, children: [] }] }],
    }, { file: 'assets/demo/main.scene' }), /omitted children/);
    assert.deepEqual(treeToGraph({ children: [] }, { file: 'assets/demo/main.scene' }).nodes, []);
  });

  for (const [label, tree] of [
    ['an object with no tree structure', {}],
    ['an array in place of a tree', []],
    ['a non-array child collection', { reference: { id: 'root' }, children: {} }],
    ['a child with no identity', { children: [{ name: 'LostNode', children: [{ reference: { id: 'grandchild' } }] }] }],
  ]) {
    it(`rejects ${label} instead of silently losing scene nodes`, () => {
      assert.throws(() => {
        const graph = treeToGraph(tree, { file: 'assets/demo/main.scene' });
        validateLiveGraph(graph);
      }, /tree|node|identity|children|reference/i);
    });
  }

  it('rejects duplicate live node identities instead of publishing conflicting handles', () => {
    assert.throws(() => {
      const graph = treeToGraph({ children: [
        { reference: { id: 'same-id' }, name: 'First' },
        { reference: { id: 'same-id' }, name: 'Second' },
      ] }, { file: 'assets/demo/main.scene' });
      validateLiveGraph(graph);
    }, /duplicate|identity|handle/i);
  });
});
