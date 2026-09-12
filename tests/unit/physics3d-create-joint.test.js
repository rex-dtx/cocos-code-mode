'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { ExpansionTools } = requireDist('utcp/tools/expansion-tools.js');

function createSceneMock(options = {}) {
  const calls = [];
  const nodes = new Map([
    ['body-node', { uuid: 'body-node', __comps__: [{ type: 'cc.RigidBody', value: { uuid: { value: 'body-component' } } }] }],
    ['connected-node', { uuid: 'connected-node', __comps__: [{ type: 'cc.RigidBody', value: { uuid: { value: 'connected-component' } } }] }],
  ]);
  let componentSequence = 0;
  let snapshotCount = 0;
  const request = async (service, message, payload) => {
    calls.push({ service, message, payload });
    assert.equal(service, 'scene');
    switch (message) {
      case 'query-node': return nodes.get(payload) ?? null;
      case 'create-component': {
        const node = nodes.get(payload.uuid);
        assert.ok(node);
        const uuid = `joint-component-${++componentSequence}`;
        node.__comps__.push({ type: payload.component, value: { uuid: { value: uuid } } });
        return uuid;
      }
      case 'set-property': {
        if (options.refuseConnectedBody) return false;
        const node = nodes.get(payload.uuid);
        const match = /^_components\.(\d+)\.connectedBody$/.exec(payload.path);
        assert.ok(match, `unexpected set-property path ${payload.path}`);
        node.__comps__[Number(match[1])].value.connectedBody = { value: { ...payload.dump.value }, type: payload.dump.type };
        return true;
      }
      case 'snapshot': snapshotCount += 1; return true;
      case 'remove-component': {
        for (const node of nodes.values()) node.__comps__ = node.__comps__.filter((component) => component.value.uuid.value !== payload.uuid);
        return true;
      }
      default: throw new Error(`unexpected scene message ${message}`);
    }
  };
  return { request, calls, nodes, get snapshotCount() { return snapshotCount; } };
}

afterEach(() => { delete global.Editor; });

describe('physics3dCreateJoint', () => {
  it('creates and verifies a bounded PhysX fixed constraint using public scene IPC', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };
    const result = await new ExpansionTools().physics3dCreateJoint({
      backend: 'physx', joint: 'fixed',
      bodyReference: { id: 'body-node', type: 'cc.Node' },
      connectedBodyReference: { id: 'connected-node', type: 'cc.Node' },
    });
    assert.deepEqual(result, {
      backend: 'physx',
      jointReference: { id: 'joint-component-1', type: 'cc.FixedConstraint' },
      bodyReference: { id: 'body-node', type: 'cc.Node' },
      connectedBodyReference: { id: 'connected-node', type: 'cc.Node' },
      jointType: 'cc.FixedConstraint',
    });
    assert.deepEqual(scene.calls.filter((call) => call.message === 'create-component').map((call) => call.payload.component), ['cc.FixedConstraint']);
    assert.ok(scene.calls.every((call) => call.service === 'scene'));
    assert.equal(scene.snapshotCount, 1);
  });

  it('rejects unsupported backend, type, same endpoint, and malformed endpoint before mutation', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };
    const tools = new ExpansionTools();
    await assert.rejects(tools.physics3dCreateJoint({ backend: 'builtin', bodyReference: { id: 'body-node' }, connectedBodyReference: { id: 'connected-node' } }), (error) => error.code === 'UNSUPPORTED_BACKEND' && error.status === 422);
    await assert.rejects(tools.physics3dCreateJoint({ backend: 'physx', joint: 'distance', bodyReference: { id: 'body-node' }, connectedBodyReference: { id: 'connected-node' } }), (error) => error.code === 'UNSUPPORTED_JOINT' && error.status === 422);
    await assert.rejects(tools.physics3dCreateJoint({ backend: 'physx', bodyReference: { id: 'body-node' }, connectedBodyReference: { id: 'body-node' } }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    await assert.rejects(tools.physics3dCreateJoint({ backend: 'physx', bodyReference: { id: '' }, connectedBodyReference: { id: 'connected-node' } }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    assert.deepEqual(scene.calls, []);
  });

  it('rolls back a created constraint when connectedBody assignment fails', async () => {
    const scene = createSceneMock({ refuseConnectedBody: true });
    global.Editor = { Message: { request: scene.request } };
    await assert.rejects(new ExpansionTools().physics3dCreateJoint({ backend: 'physx', bodyReference: { id: 'body-node' }, connectedBodyReference: { id: 'connected-node' } }), /refused cc\.FixedConstraint\.connectedBody assignment/);
    assert.equal(scene.nodes.get('body-node').__comps__.length, 1);
    assert.equal(scene.calls.filter((call) => call.message === 'remove-component').length, 1);
    assert.equal(scene.snapshotCount, 1);
  });

  it('registers a bounded schema with no generic execution route', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/expansion-tools.ts'), 'utf8');
    const start = source.indexOf("'physics3dCreateJoint'");
    const end = source.indexOf("@utcpTool('physics3dInspect'", start);
    const contract = source.slice(start, end);
    assert.match(contract, /additionalProperties: false/);
    assert.match(contract, /enum: \['builtin', 'cannon', 'physx'\]/);
    assert.match(contract, /enum: \['fixed', 'hinge', 'pointToPoint', 'distance'\]/);
    assert.doesNotMatch(contract, /executeJavascript|execute-scene-script|Editor\.Panel/);
  });
});
