'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { ExpansionTools } = requireDist('utcp/tools/expansion-tools.js');

function createSceneMock(options = {}) {
  const calls = [];
  const nodes = new Map();
  let componentSequence = 0;
  let snapshotCount = 0;

  const request = async (service, message, payload) => {
    calls.push({ service, message, payload });
    assert.equal(service, 'scene');
    switch (message) {
      case 'query-node-tree':
        return { uuid: 'scene-root', children: [] };
      case 'query-node':
        if (payload === 'scene-root') return { uuid: 'scene-root', name: 'Scene', __comps__: [] };
        return nodes.get(payload) ?? null;
      case 'create-node': {
        const uuid = 'created-node';
        nodes.set(uuid, { uuid, name: payload.name, __comps__: [] });
        return uuid;
      }
      case 'create-component': {
        const node = nodes.get(payload.uuid);
        const uuid = `component-${++componentSequence}`;
        const value = { uuid: { value: uuid } };
        if (payload.component === 'cc.BoxCollider') {
          value.size = { value: { x: 1, y: 1, z: 1 }, type: 'cc.Vec3' };
        }
        node.__comps__.push({ type: payload.component, value });
        return uuid;
      }
      case 'set-property': {
        if (options.refuseSize) return false;
        const node = nodes.get(payload.uuid);
        const match = /^__comps__\.(\d+)\.size$/.exec(payload.path);
        assert.ok(match, `unexpected set-property path ${payload.path}`);
        node.__comps__[Number(match[1])].value.size = {
          value: { ...payload.dump.value },
          type: payload.dump.type,
        };
        return true;
      }
      case 'snapshot':
        snapshotCount += 1;
        return true;
      case 'remove-node':
        nodes.delete(payload.uuid);
        return true;
      default:
        throw new Error(`unexpected scene message ${message}`);
    }
  };

  return { request, calls, nodes, get snapshotCount() { return snapshotCount; } };
}

afterEach(() => { delete global.Editor; });

describe('physics3dCreateBody', () => {
  it('creates and verifies the bounded PhysX box body through public scene IPC', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };

    const result = await new ExpansionTools().physics3dCreateBody({
      backend: 'physx',
      collider: 'box',
      name: 'Crate',
      size: { x: 1.25, y: 2.5, z: 3.75 },
    });

    assert.deepEqual(result, {
      reference: { id: 'created-node', type: 'cc.Node' },
      bodyReference: { id: 'component-1', type: 'cc.RigidBody' },
      colliderReference: { id: 'component-2', type: 'cc.BoxCollider' },
      backend: 'physx',
      bodyType: 'cc.RigidBody',
      colliderType: 'cc.BoxCollider',
      collider: 'box',
      size: { x: 1.25, y: 2.5, z: 3.75 },
      components: ['cc.RigidBody', 'cc.BoxCollider'],
      verified: true,
    });
    assert.equal(scene.snapshotCount, 1);
    assert.deepEqual(
      scene.calls.filter((call) => call.message === 'create-component').map((call) => call.payload.component),
      ['cc.RigidBody', 'cc.BoxCollider'],
    );
    assert.ok(scene.calls.every((call) => call.service === 'scene'));
  });

  it('rejects unsupported backend, collider, and malformed size before mutation', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };
    const tools = new ExpansionTools();

    await assert.rejects(
      tools.physics3dCreateBody({ backend: 'cannon' }),
      (error) => error.code === 'UNSUPPORTED_BACKEND' && error.status === 422,
    );
    await assert.rejects(
      tools.physics3dCreateBody({ backend: 'physx', collider: 'sphere' }),
      (error) => error.code === 'UNSUPPORTED_COLLIDER' && error.status === 422,
    );
    await assert.rejects(
      tools.physics3dCreateBody({ backend: 'physx', size: { x: 0, y: 1, z: 1 } }),
      (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400,
    );
    assert.deepEqual(scene.calls, []);
  });

  it('removes the created node when a mid-flight property mutation fails', async () => {
    const scene = createSceneMock({ refuseSize: true });
    global.Editor = { Message: { request: scene.request } };

    await assert.rejects(
      new ExpansionTools().physics3dCreateBody({ backend: 'physx' }),
      /refused cc\.BoxCollider\.size assignment/,
    );
    assert.equal(scene.nodes.has('created-node'), false);
    assert.equal(scene.calls.filter((call) => call.message === 'remove-node').length, 1);
    assert.equal(scene.snapshotCount, 1);
  });

  it('registers a bounded schema without arbitrary execution or fallback routes', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/expansion-tools.ts'), 'utf8');
    const start = source.indexOf("'physics3dCreateBody'");
    const end = source.indexOf("@utcpTool('physics3dInspect'", start);
    const contract = source.slice(start, end);

    assert.match(contract, /additionalProperties: false/);
    assert.match(contract, /enum: \['builtin', 'cannon', 'physx'\]/);
    assert.match(contract, /enum: \['box', 'sphere', 'capsule', 'mesh'\]/);
    assert.doesNotMatch(contract, /executeJavascript|execute-scene-script|fs\.|Editor\.Panel/);
  });
});
