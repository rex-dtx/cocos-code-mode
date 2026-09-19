'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { AnimationTools } = requireDist('utcp/tools/animation-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

describe('typed animation tools', () => {
  it('registers clip authoring, analysis, runtime control, and cache routes', () => {
    const names = new Set(ToolRegistry.getTools().map(({ tool }) => tool.name));
    for (const name of ['animationClipConfigure', 'animationTrackEdit', 'animationKeyframeEdit', 'animationEventEdit', 'animationAuxCurveEdit', 'animationUsageAnalyze', 'animationCatalogInspect', 'animationCompatibilityAudit', 'animationBatchControl', 'spineRuntimeControl', 'spineEditorConfigure', 'spineSocketConfigure', 'animationRuntimeControl']) {
    }
  });
  it('returns per-node batch outcomes without aborting on one runtime failure', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async (_service, _message, payload) => {
      if (payload.args[0].nodeUuid === 'bad') throw new Error('node unavailable');
      return { nodeUuid: payload.args[0].nodeUuid, operation: payload.args[0].operation };
    } } };
    try {
      const result = await new AnimationTools().animationBatchControl({
        nodeReferences: [{ id: 'good' }, { id: 'bad' }],
        operation: 'play',
        clipName: 'idle',
      });
      assert.equal(result.total, 2);
      assert.equal(result.results.length, 1);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].nodeReference.id, 'bad');
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('maps typed clip and track edits to native animation operations', async () => {
    const requests = [];
    const previous = global.Editor;
    global.Editor = { Message: { request: async (...args) => {
      requests.push(args);
      if (args[1] === 'change-edit-clip') return true;
      return { state: 'success', result: { changed: true } };
    } } };
    try {
      const tools = new AnimationTools();
      assert.equal((await tools.animationClipConfigure({ clipReference: { id: 'clip' }, operation: 'speed', value: 1.5 })).success, true);
      assert.equal((await tools.animationTrackEdit({ clipReference: { id: 'clip' }, operation: 'copy_to', nodePath: '/Root', propKey: 'position', destinationNodePath: '/Copy', destinationPropKey: 'position' })).success, true);
      assert.deepEqual(requests[0], ['scene', 'change-edit-clip', 'clip']);
      assert.deepEqual(requests[1], ['scene', 'animation-operation', [{ funcName: 'changeSpeed', args: [1.5] }], { recordUndo: true }]);
      assert.deepEqual(requests[2], ['scene', 'change-edit-clip', 'clip']);
      assert.deepEqual(requests[3], ['scene', 'animation-operation', [{ funcName: 'copyPropTo', args: ['/Root', 'position', '/Copy', 'position'] }], { recordUndo: true }]);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('maps keyframe, event, and auxiliary curve edits with bounded arguments', async () => {
    const requests = [];
    const previous = global.Editor;
    global.Editor = { Message: { request: async (...args) => {
      requests.push(args);
      if (args[1] === 'change-edit-clip') return true;
      return { state: 'success', result: null };
    } } };
    try {
      const tools = new AnimationTools();
      await tools.animationKeyframeEdit({ clipReference: { id: 'clip' }, operation: 'move', nodePath: '/Root', propKey: 'position', frames: [0, 10], offsets: 2 });
      await tools.animationEventEdit({ clipReference: { id: 'clip' }, operation: 'add', frame: 12, functionName: 'onFinished', parameters: ['win'] });
      await tools.animationAuxCurveEdit({ clipReference: { id: 'clip' }, operation: 'create_key', name: 'weight', frame: 8, customData: { value: 1 } });
      assert.deepEqual(requests.filter((args) => args[1] === 'animation-operation').map((args) => args[2][0]), [
        { funcName: 'moveKeys', args: ['/Root', 'position', [0, 10], 2] },
        { funcName: 'addEvent', args: [12, 'onFinished', ['win']] },
        { funcName: 'createAuxKey', args: ['weight', 8, { value: 1 }] },
      ]);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('rejects invalid animation ranges and operation values before IPC', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async () => { throw new Error('IPC must not run'); } } };
    try {
      const tools = new AnimationTools();
      await assert.rejects(() => tools.animationClipConfigure({ clipReference: { id: 'clip' }, operation: 'speed', value: -1 }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
      await assert.rejects(() => tools.animationKeyframeEdit({ clipReference: { id: 'clip' }, operation: 'remove', nodePath: '/Root', propKey: 'position', frames: [] }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
      await assert.rejects(() => tools.animationEventEdit({ clipReference: { id: 'clip' }, operation: 'move', frames: [1], offset: 0.5 }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('returns bounded usage analysis and live runtime control read-back', async () => {
    const previous = global.Editor;
    const calls = [];
    global.Editor = { Message: { request: async (_service, _message, payload) => {
      calls.push(payload);
      if (payload.method === 'animationUsageAnalyze') return { nodeUuid: 'scene', visitedNodes: 4, truncated: false, componentCount: 1, findings: [{ component: 'Animation', recommendations: [] }] };
      return { nodeUuid: 'node', operation: payload.args[0].operation, animation: { clips: [{ name: 'idle' }] }, spine: null, dragonBones: null };
    } } };
    try {
      const tools = new AnimationTools();
      const analysis = await tools.animationUsageAnalyze({ maxNodes: 50 });
      assert.equal(analysis.componentCount, 1);
      assert.deepEqual(analysis.nodeReference, { id: 'scene', type: 'cc.Node' });
      const controlled = await tools.animationRuntimeControl({
        nodeReference: { id: 'node' },
        operation: 'set_state',
        clipName: 'idle',
        speed: 1.5,
        weight: 0.75,
        delay: 0.2,
        playbackRange: { min: 0.1, max: 1.8 }
      });
      assert.equal(controlled.operation, 'set_state');
      assert.deepEqual(controlled.nodeReference, { id: 'node', type: 'cc.Node' });
      assert.equal(calls[1].args[0].speed, 1.5);
      assert.equal(calls[1].args[0].weight, 0.75);
      assert.deepEqual(calls[1].args[0].playbackRange, { min: 0.1, max: 1.8 });
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });
  it('assigns clips and lists animation components through editor scene routes', async () => {
    const previous = global.Editor;
    const calls = [];
    global.Editor = {
      Message: {
        request: async (service, message, payload) => {
          calls.push({ service, message, payload });
          if (service === 'asset-db' && message === 'query-asset-info') return { uuid: 'clip', type: 'cc.AnimationClip', importer: 'animation-clip' };
          if (message === 'execute-scene-script' && payload.method === 'animationClipAssign') return { success: true, clipName: 'idle', clips: [{ uuid: 'clip', name: 'idle' }] };
          if (message === 'execute-scene-script' && payload.method === 'animationComponentsList') return { animations: [{ nodeUuid: 'node', defaultClip: 'idle', clips: ['idle'] }] };
          throw new Error(`unexpected ${service}:${message}`);
        },
      },
    };
    try {
      const tools = new AnimationTools();
      const assigned = await tools.animationClipAssign({ nodeReference: { id: 'node' }, clipReference: { id: 'clip' } });
      assert.equal(assigned.success, true);
      assert.deepEqual(assigned.clipReference, { id: 'clip', type: 'cc.AnimationClip' });
      const listed = await tools.animationComponentsList({ nodeReference: { id: 'node' } });
      assert.deepEqual(listed.animations, [{ nodeUuid: 'node', defaultClip: 'idle', clips: ['idle'] }]);
      assert.deepEqual(calls.map((call) => call.message), ['query-asset-info', 'execute-scene-script', 'execute-scene-script']);
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('maps Creator runtime control failures to typed errors', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async () => { throw new Error('Animation cache mode is unavailable on this component'); } } };
    try {
      const tools = new AnimationTools();
      await assert.rejects(
        () => tools.animationRuntimeControl({ nodeReference: { id: 'node' }, operation: 'set_cache_mode', cacheMode: 'SHARED_CACHE' }),
        (error) => error.code === 'ANIMATION_CONTROL_FAILED'
          && error.status === 502
          && error.recovery.includes('REALTIME'),
      );
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });

  it('rejects incomplete full-control requests before scene execution', async () => {
    const previous = global.Editor;
    global.Editor = { Message: { request: async () => { throw new Error('IPC must not run'); } } };
    try {
      const tools = new AnimationTools();
      await assert.rejects(() => tools.animationRuntimeControl({ nodeReference: { id: 'node' }, operation: 'set_cache_mode' }), (error) => error.code === 'INVALID_ARGUMENT');
      await assert.rejects(() => tools.animationRuntimeControl({ nodeReference: { id: 'node' }, operation: 'set_state', clipName: 'idle' }), (error) => error.code === 'INVALID_ARGUMENT');
      await assert.rejects(() => tools.animationRuntimeControl({ nodeReference: { id: 'node' }, operation: 'set_state', clipName: 'idle', playbackRange: { min: 2, max: 1 } }), (error) => error.code === 'INVALID_ARGUMENT');
      await assert.rejects(() => tools.animationUsageAnalyze({ maxNodes: 201 }), (error) => error.code === 'INVALID_ARGUMENT');
    } finally {
      if (previous === undefined) delete global.Editor;
      else global.Editor = previous;
    }
  });
});
