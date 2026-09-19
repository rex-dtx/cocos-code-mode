'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { SceneTools } = requireDist('utcp/tools/scene-tools.js');
const { ComponentTools } = requireDist('utcp/tools/component-tools.js');
const { SetPropertyTool } = requireDist('utcp/tools/set-properties-tool.js');

const previousEditor = global.Editor;
afterEach(() => { global.Editor = previousEditor; });

describe('scene authoring mutation postconditions', () => {
  it('confirms opened scene identity and rejects mismatched read-back', async () => {
    const calls = [];
    global.Editor = { Message: { request: async (_module, message, payload) => {
      calls.push([message, payload]);
      if (message === 'open-scene') return true;
      if (message === 'query-current-scene') return { uuid: 'other-scene' };
      throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(
      new SceneTools().sceneOpen({ reference: { id: 'requested-scene' } }),
      error => error.code === 'SCENE_OPEN_UNCONFIRMED' && error.status === 502,
    );
    assert.deepEqual(calls, [['open-scene', 'requested-scene'], ['query-current-scene', undefined]]);
  });

  it('creates a node only when query-node confirms the returned UUID', async () => {
    let confirmed = false;
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'create-node') return 'created-node';
      if (message === 'snapshot') return true;
      if (message === 'query-node') return confirmed ? { uuid: payload } : null;
      throw new Error(`unexpected ${message}`);
    } } };
    const tool = new SceneTools();
    await assert.rejects(
      tool.sceneCreateNode({ name: 'Child', parentReference: { id: 'parent' } }),
      error => error.code === 'NODE_CREATE_UNCONFIRMED',
    );
    confirmed = true;
    assert.deepEqual(await tool.sceneCreateNode({ name: 'Child', parentReference: { id: 'parent' } }), {
      reference: { id: 'created-node', type: 'cc.Node' },
    });
  });

  it('fails move when the authoritative parent read-back differs', async () => {
    let queries = 0;
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node') {
        queries++;
        return queries === 1 ? { uuid: payload } : { uuid: payload, parent: { value: { uuid: 'wrong-parent' } } };
      }
      if (message === 'set-parent' || message === 'snapshot') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(
      new SceneTools().nodeOperate({ operation: 'move', reference: { id: 'child' }, newParentReference: { id: 'parent' } }),
      error => error.code === 'NODE_MOVE_UNCONFIRMED',
    );
  });
});

describe('component authoring mutation postconditions', () => {
  it('removes a component only when query-component confirms absence', async () => {
    let queries = 0;
    global.Editor = { Message: { request: async (_module, message) => {
      if (message === 'query-component') return ++queries === 1 ? { uuid: 'component' } : { uuid: 'component' };
      if (message === 'remove-component') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(
      new ComponentTools().nodeComponentRemove({ reference: { id: 'component' } }),
      /still exists after removal/,
    );
  });

  it('adds a component with type and UUID verified from node read-back', async () => {
    let queryCount = 0;
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node') {
        queryCount++;
        if (queryCount === 1) return { __comps__: [] };
        return { __comps__: [{ type: 'cc.Label', value: { uuid: { value: 'label-component' } } }] };
      }
      if (message === 'execute-scene-script') return payload.method === 'stopCatchLogging' ? [] : true;
      if (message === 'create-component' || message === 'snapshot') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(
      await new ComponentTools().nodeComponentAdd({ reference: { id: 'node' }, componentType: 'cc.Label' }),
      { reference: { id: 'label-component', type: 'cc.Label' } },
    );
  });
});

describe('inspector property mutation postconditions', () => {
  it('rejects a set-property success when a fresh dump keeps the old value', async () => {
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node') return {
        uuid: payload,
        __type__: 'cc.Node',
        __comps__: [],
        children: { value: [] },
        active: { value: false, type: 'Boolean' },
      };
      if (message === 'set-property' || message === 'snapshot') return true;
      if (_module === 'asset-db') return null;
      throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(
      new SetPropertyTool().setInstanceProperties({ reference: { id: 'node' }, propertyPaths: ['active'], values: [true] }),
      /Property mutation was not confirmed/,
    );
  });
});
