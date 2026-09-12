'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireDist, readSource } = require('../helpers/require-dist');

const { ExpansionTools } = requireDist('utcp/tools/expansion-tools.js');

function createSceneMock(options = {}) {
  const calls = [];
  let snapshotCount = 0;
  let refused = false;
  const node = {
    uuid: { value: 'audio-node' },
    name: 'AudioFixture',
    __comps__: [{
      type: 'cc.AudioSource',
      value: {
        uuid: { value: 'audio-component' },
        volume: { value: 0.25, type: 'Float' },
        loop: { value: false, type: 'Boolean' },
        playOnAwake: { value: true, type: 'Boolean' },
        clip: { value: { uuid: 'old-clip' }, type: 'cc.AudioClip' },
      },
    }],
  };
  const snapshotRefused = options.snapshotRefused === true;

  const request = async (service, message, payload) => {
    calls.push({ service, message, payload });
    if (message === 'query-node') return payload === 'audio-node' ? node : null;
    if (message === 'query-component') {
      return payload === 'audio-component' ? { type: 'cc.AudioSource', value: { ...node.__comps__[0].value, node: { value: { uuid: 'audio-node' }, type: 'cc.Node' } } } : null;
    }
    if (message === 'query-asset-info') return payload === 'new-clip' ? { type: 'cc.AudioClip' } : null;
    if (message === 'set-property') {
      assert.equal(payload.uuid, 'audio-node', 'writes must use the unwrapped node UUID');
      const match = /^__comps__\.0\.(volume|loop|playOnAwake|clip)$/.exec(payload.path);
      assert.ok(match, `unexpected path ${payload.path}`);
      if (options.refuseKey === match[1] && !refused) {
        refused = true;
        return false;
      }
      node.__comps__[0].value[match[1]] = payload.dump;
      return true;
    }
    if (message === 'snapshot') {
      snapshotCount += 1;
      return snapshotRefused ? false : true;
    }
    throw new Error(`unexpected scene message ${message}`);
  };

  return { request, calls, node, get snapshotCount() { return snapshotCount; } };
}

afterEach(() => { delete global.Editor; });

describe('audioSourceConfigure', () => {
  it('preflights and atomically configures bounded properties through public scene IPC', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };

    const result = await new ExpansionTools().audioSourceConfigure({
      reference: { id: 'audio-node', type: 'cc.Node' },
      properties: { volume: 0.75, loop: true, playOnAwake: false },
    });

    assert.deepEqual(result, {
      reference: { id: 'audio-node', type: 'cc.Node' },
      componentReference: { id: 'audio-component', type: 'cc.AudioSource' },
      properties: { volume: 0.75, loop: true, playOnAwake: false, clip: { id: 'old-clip', type: 'cc.AudioClip' } },
      changed: ['volume', 'loop', 'playOnAwake'],
      verified: true,
    });
    assert.equal(scene.snapshotCount, 1);
    assert.deepEqual(scene.calls.filter((call) => call.message === 'set-property').map((call) => call.payload.path), [
      '__comps__.0.volume', '__comps__.0.loop', '__comps__.0.playOnAwake',
    ]);
    assert.ok(scene.calls.every((call) => call.service === 'scene'));
  });

  it('supports a proven typed AudioClip UUID without exposing playback operations', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };

    const result = await new ExpansionTools().audioSourceConfigure({
      reference: { id: 'audio-node', type: 'cc.Node' },
      properties: { clip: { id: 'new-clip', type: 'cc.AudioClip' } },
    });

    assert.equal(result.properties.clip.id, 'new-clip');
    const setCall = scene.calls.find((call) => call.message === 'set-property');
    assert.deepEqual(setCall.payload.dump, { value: { uuid: 'new-clip' }, type: 'cc.AudioClip' });
    assert.equal(scene.snapshotCount, 1);
  });

  it('rolls back every attempted field and verifies the captured dumps on refusal', async () => {
    const scene = createSceneMock({ refuseKey: 'loop' });
    global.Editor = { Message: { request: scene.request } };

    await assert.rejects(
      new ExpansionTools().audioSourceConfigure({
        reference: { id: 'audio-node', type: 'cc.Node' },
        properties: { volume: 0.9, loop: true },
      }),
      (error) => error.code === 'MUTATION_FAILED',
    );
    assert.deepEqual(scene.node.__comps__[0].value.volume, { value: 0.25, type: 'Float' });
    assert.deepEqual(scene.node.__comps__[0].value.loop, { value: false, type: 'Boolean' });
    assert.equal(scene.calls.filter((call) => call.message === 'set-property').length, 4);
    assert.equal(scene.snapshotCount, 1);
  });

  it('rejects malformed or out-of-range requests before querying or mutating the scene', async () => {
    const scene = createSceneMock();
    global.Editor = { Message: { request: scene.request } };
    const tools = new ExpansionTools();

    await assert.rejects(tools.audioSourceConfigure({ reference: { id: 'audio-node', type: 'cc.Node' }, properties: {} }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    await assert.rejects(tools.audioSourceConfigure({ reference: { id: 'audio-node', type: 'cc.Node' }, properties: { volume: 1.1 } }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    await assert.rejects(tools.audioSourceConfigure({ reference: { id: 'audio-node', type: 'cc.Node' }, properties: { clip: { id: 'new-clip', type: 'cc.String' } } }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    assert.deepEqual(scene.calls, []);
  });

  it('declares a strict mutating candidate contract with no execute route', () => {
    const source = readSource('utcp/tools/expansion-tools.ts');
    const start = source.indexOf("'audioSourceConfigure'");
    const end = source.indexOf("@utcpTool('audioSourceAudit'", start);
    const contract = source.slice(start, end);
    assert.match(contract, /additionalProperties: false/);
    assert.match(contract, /minProperties: 1/);
    assert.match(contract, /const: 'cc.AudioClip'/);
    assert.match(contract, /'POST'/);
    assert.doesNotMatch(contract, /executeJavascript|execute-scene-script/);
    const profiles = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tool-profiles.ts'), 'utf8');
    assert.match(profiles, /configure/);
  });
});
