import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { treeToGraph, unwrapLiveSnapshot, validateLiveGraph } from '../src/live.mjs';

const file = 'assets/scenes/example.fire';
const snapshot = {
  name: 'Example',
  uuid: 'scene-root',
  nodesVisited: 2,
  budgetExhausted: false,
  children: [{
    name: 'Canvas',
    uuid: 'canvas-node',
    components: [{ type: 'cc.Canvas', uuid: 'canvas-component' }],
    children: [{ name: 'Label', uuid: 'label-node', components: [{ type: 'cc.Label', uuid: 'label-component' }] }],
  }],
};

describe('Creator 2.4 live sceneSnapshot adapter', () => {
  it('preserves node and component identity with computed paths', () => {
    const graph = treeToGraph(snapshot, { file });
    assert.equal(validateLiveGraph(graph), true);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.comps.length, 2);
    assert.deepEqual(graph.nodes.map((node) => node.path), ['/Canvas', '/Canvas/Label']);
    assert.equal(graph.comps[0].handle, `${file}#component:canvas-component`);
    assert.equal(graph.omittedNodes, 0);
  });

  it('keeps absent dirty state advisory', () => {
    assert.equal(unwrapLiveSnapshot({ sourceFile: file, tree: snapshot }).dirty, 'unknown');
    assert.equal(unwrapLiveSnapshot({ sourceFile: file, dirty: false, tree: snapshot }).dirty, false);
  });
  it('rejects incomplete snapshots before publication', () => {
    assert.throws(() => treeToGraph({ ...snapshot, budgetExhausted: true }, { file }), /exhausted maxNodes/);
    assert.throws(() => treeToGraph({ children: [{ ...snapshot.children[0], truncated: 'maxDepth' }] }, { file }), /truncated/);
    assert.throws(() => treeToGraph({ children: [{ name: 'MissingUuid' }] }, { file }), /has no UUID/);
    assert.throws(() => treeToGraph({ children: [{ ...snapshot.children[0], childrenOmitted: 1 }] }, { file }), /omitted children/);
  });
});
