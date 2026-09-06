'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

const { findNodesInHierarchy } = requireDist('utcp/tools-2x/scene-read-tools.js');

const tree = [
  {
    name: 'Editor Scene Background',
    id: 'hidden-root',
    hidden: true,
    children: [{ name: 'Scene Grid', id: 'grid' }],
  },
  {
    name: 'Canvas',
    id: 'canvas',
    hidden: false,
    children: [
      { name: 'background', id: 'bg' },
      { name: 'label', id: 'lbl' },
      { name: 'HeroSprite', id: 'hero' },
    ],
  },
];

describe('findNodesInHierarchy', () => {
  it('skips hidden editor roots and matches name substring', () => {
    const result = findNodesInHierarchy(tree, { name: 'label', maxResults: 50 });
    assert.equal(result.total, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.nodes[0].uuid, 'lbl');
    assert.equal(result.nodes[0].path, 'Canvas/label');
    assert.deepEqual(result.nodes[0].reference, { id: 'lbl', type: 'cc.Node' });
  });

  it('does not return hidden editor children via hidden roots', () => {
    const result = findNodesInHierarchy(tree, { name: 'grid', maxResults: 50 });
    assert.equal(result.total, 0);
    assert.deepEqual(result.nodes, []);
  });

  it('intersects with an id set for component filters', () => {
    const result = findNodesInHierarchy(tree, { name: 'hero', idSet: new Set(['hero', 'bg']), maxResults: 50 });
    assert.equal(result.total, 1);
    assert.equal(result.nodes[0].uuid, 'hero');
  });

  it('caps results and reports truncated', () => {
    const result = findNodesInHierarchy(tree, { name: 'a', maxResults: 1 });
    assert.ok(result.total >= 2);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.truncated, true);
  });

  it('registers findNodes and UI helpers as tools', () => {
    const read = readSource('utcp/tools-2x/scene-read-tools.ts');
    const write = readSource('utcp/tools-2x/scene-write-tools.ts');
    assert.match(read, /@utcpTool\(\s*'findNodes'/);
    assert.match(read, /@utcpTool\(\s*'sceneBatchGet'/);
    assert.match(write, /@utcpTool\(\s*'createUiNode'/);
    assert.match(write, /@utcpTool\(\s*'createLabel'/);
    assert.match(write, /@utcpTool\(\s*'createButton'/);
    assert.match(write, /@utcpTool\(\s*'createSprite'/);
  });
});
