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

describe('scene inspection identity contracts', () => {
  it('nodeGetTree returns authoritative component UUID and type', async () => {
    global.Editor = { Message: { request: async (_module, message) => {
      if (message === 'query-node-tree') return {
        uuid: 'root', name: 'Root', components: [{ value: { uuid: { value: 'comp-1' }, __type__: { value: 'cc.Label' } } }], children: [],
      };
      if (message === 'query-current-scene') return null;
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().nodeGetTree({ fields: ['components'] }), {
      reference: { id: 'root', type: 'cc.Node' },
      components: [{ reference: { id: 'comp-1', type: 'cc.Label' } }],
      children: [],
    });
  });

  it('nodeComponentsGet rejects a matched component missing authoritative type', async () => {
    global.Editor = { Message: { request: async (_module, message) => {
      if (message === 'query-node') return { __comps__: [{ value: { uuid: { value: 'comp-1' } } }] };
      throw new Error(`unexpected ${message}`);
    } } };
    await assert.rejects(
      new ComponentTools().nodeComponentsGet({ reference: { id: 'node' } }),
      /lacks authoritative uuid\/type/,
    );
  });

  it('inspectorSet rejects malformed property arrays with typed error', async () => {
    await assert.rejects(
      new SetPropertyTool().setInstanceProperties({ reference: { id: 'node' }, propertyPaths: [], values: [] }),
      error => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
  });
});
describe('camera authoring adapters', () => {
  it('creates a camera and confirms node/component identity', async () => {
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node-tree') return { uuid: 'root' };
      if (message === 'create-node') return 'camera-node';
      if (message === 'create-component') return true;
      if (message === 'query-node') return { uuid: payload, __comps__: [{ type: 'cc.Camera', uuid: 'camera-component' }] };
      if (message === 'snapshot' || message === 'set-property') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().cameraCreate({ name: 'Camera' }), {
      nodeReference: { id: 'camera-node', type: 'cc.Node' },
      cameraReference: { id: 'camera-component', type: 'cc.Camera' },
    });
  });

  it('lists cameras with bounded authoritative component references', async () => {
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node-tree') return { uuid: 'root', name: 'Root', children: [{ uuid: 'node-1', name: 'Main Camera', children: [] }] };
      if (message === 'query-node') return payload === 'root' ? { uuid: 'root', __comps__: [] } : { uuid: payload, __comps__: [{ type: 'cc.Camera', value: { uuid: { value: 'camera-1' }, projection: { value: 0 } } }] };
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().cameraList(), {
      cameras: [{ nodeReference: { id: 'node-1', type: 'cc.Node' }, name: 'Main Camera', cameraReference: { id: 'camera-1', type: 'cc.Camera' }, priority: undefined, visibility: undefined, projection: 0 }],
      total: 1,
      truncated: false,
    });
  });

  it('sets camera properties only when read-back matches', async () => {
    global.Editor = { Message: { request: async (_module, message, payload) => {
      if (message === 'query-node-tree') return { uuid: 'root', children: [{ uuid: 'node-1', __comps__: [{ type: 'cc.Camera', value: { uuid: { value: 'camera-1' }, fov: { value: 45 } } }], children: [] }] };
      if (message === 'query-node') return { uuid: 'node-1', __comps__: [{ type: 'cc.Camera', value: { uuid: { value: 'camera-1' }, fov: { value: 45 } } }] };
      if (message === 'set-property' || message === 'snapshot') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().cameraSetProperties({ reference: { id: 'camera-1' }, properties: { fov: 45 } }), { updated: true, reference: { id: 'camera-1', type: 'cc.Camera' } });
  });
});

describe('final scene adapters', () => {
  it('creates a scene asset only after asset-db identity read-back', async () => {
    const calls = [];
    global.Editor = { Message: { request: async (service, message, ...args) => {
      calls.push([service, message, ...args]);
      if (message === 'copy-asset') return { uuid: 'scene-1' };
      if (message === 'query-asset-info') return { uuid: 'scene-1', type: 'cc.SceneAsset' };
      throw new Error(`unexpected ${service}:${message}`);
    } } };
    assert.deepEqual(await new SceneTools().sceneCreate({ assetPath: 'db://assets/final.scene' }), { success: true, reference: { id: 'scene-1', type: 'cc.SceneAsset' } });
    assert.equal(calls[0][1], 'copy-asset');
    assert.equal(calls[1][1], 'query-asset-info');
  });

  it('returns authoritative node and component inspection payloads', async () => {
    global.Editor = { Message: { request: async (_service, message, id) => {
      if (message === 'query-node') return { uuid: id, __type__: { value: 'cc.Node' }, __comps__: [] };
      if (message === 'query-component') return { uuid: id, type: 'cc.Label', string: { value: 'hello' } };
      throw new Error(`unexpected ${message}`);
    } } };
    assert.equal((await new SceneTools().sceneNodeType({ reference: { id: 'node-1' } })).type, 'cc.Node');
    assert.equal((await new SceneTools().sceneComponentInfo({ reference: { id: 'component-1' } })).type, 'cc.Label');
  });
});

describe('scene composite residual adapters', () => {
  it('sceneGetInfo returns dirty alias and hierarchy node count', async () => {
    global.Editor = { Message: { request: async (_service, message) => {
      if (message === 'query-scene-bounds') return { x: 0, y: 0, width: 10, height: 20 };
      if (message === 'query-dirty') return true;
      if (message === 'query-current-scene') return { uuid: 'scene-1', name: 'Main' };
      if (message === 'query-node-tree') return { uuid: 'root', children: [{ uuid: 'child', children: [] }] };
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().sceneGetInfo(), { bounds: { x: 0, y: 0, width: 10, height: 20 }, dirty: true, isDirty: true, nodeCount: 2, currentScene: { uuid: 'scene-1', name: 'Main' } });
  });

  it('nodeSetTransform applies exact paths and confirms read-back', async () => {
    const calls = [];
    const node = { uuid: 'node-1', position: { value: { x: 1, y: 2, z: 3 } }, eulerAngles: { value: { x: 4, y: 5, z: 6 } }, scale: { value: { x: 1, y: 1, z: 1 } }, active: { value: true } };
    global.Editor = { Message: { request: async (_service, message, payload) => {
      calls.push([message, payload]);
      if (message === 'query-node') return node;
      if (message === 'set-property') { node[payload.path] = { value: payload.dump.value }; return true; }
      if (message === 'snapshot') return true;
      throw new Error(`unexpected ${message}`);
    } } };
    assert.deepEqual(await new SceneTools().nodeSetTransform({ reference: { id: 'node-1' }, position: { x: 8, y: 9, z: 10 }, rotation: { x: 11, y: 12, z: 13 }, scale: { x: 2, y: 3, z: 4 }, active: false }), { updated: true, reference: { id: 'node-1', type: 'cc.Node' } });
    assert.deepEqual(calls.filter(([message]) => message === 'set-property').map(([, payload]) => payload.path), ['position', 'eulerAngles', 'scale', 'active']);
  });

  it('lifecycle save and save-as require authoritative outcomes', async () => {
    const calls = [];
    global.Editor = { Message: { request: async (_service, message) => {
      calls.push(message);
      if (message === 'query-dirty') return false;
      if (message === 'save-as-scene') return 'scene-2';
      if (message === 'query-current-scene') return 'scene-2';
      return true;
    } } };
    const tools = new (requireDist('utcp/tools/editor-tools.js').EditorTools)();
    assert.deepEqual(await tools.editorOperate({ operation: 'save_scene_or_prefab' }), { success: true });
    assert.deepEqual(await tools.editorOperate({ operation: 'save_as' }), { success: true, reference: { id: 'scene-2', type: 'cc.SceneAsset' } });
    assert.deepEqual(calls, ['save-scene', 'query-dirty', 'save-as-scene', 'query-current-scene']);
  });
});
