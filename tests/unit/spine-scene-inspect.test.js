'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');
const { AnimationTools } = requireDist('utcp/tools/animation-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');
}

describe('Spine scene inspection', () => {
  it('exposes bounded live Skeleton inspection with sockets and attachments', () => {
    const src = read('source/scene.ts');
    assert.match(src, /async spineSceneInspect\(/);
    assert.match(src, /component\?\.sockets/);
    assert.match(src, /skeleton\?\.bones/);
    assert.match(src, /skeleton\?\.slots/);
    assert.match(src, /getRuntimeData/);
    assert.match(src, /component\?\._skeleton/);
    assert.match(src, /component\?\.getState/);
    assert.match(src, /socket\?\.target/);
    assert.match(src, /attachmentType: slot\?\.attachment\?\.constructor\?\.name/);
    assert.match(src, /worldX/);
    assert.match(src, /attachment: slot\?\.attachment\?\.name/);
    assert.match(src, /getAnimationState/);
    assert.match(src, /trackTime/);
    assert.match(src, /tracks/);
    assert.match(src, /maxItems/);
  });

  it('registers the scene bridge tool with read-only bounded arguments', () => {
    const src = read('source/utcp/tools/animation-tools.ts');
    assert.match(src, /'spineSceneInspect'/);
    assert.match(src, /'spineAssetValidate'/);
    assert.match(src, /SOCKET_BONE_MISSING/);
    assert.match(src, /DUPLICATE_BONE_NAME/);
    assert.match(src, /BONE_PARENT_CYCLE/);
    assert.match(src, /BONE_PARENT_MISSING/);
    assert.match(src, /DUPLICATE_SLOT_NAME/);
    assert.match(src, /DUPLICATE_SOCKET_NAME/);
    assert.match(src, /required: \['code', 'path', 'message'\]/);
    assert.match(src, /atlasRegions/);
    assert.match(src, /constraints: \{ type: 'integer' \}/);
    assert.match(src, /findings: \{ type: 'array', maxItems: 1000, items:/);
    assert.match(src, /'execute-scene-script'/);

    assert.match(src, /method: 'spineSceneInspect'/);
    assert.match(src, /SPINE_SCENE_INSPECTION_FAILED/);
    assert.match(src, /maximum: 1000/);
    const tool = ToolRegistry.getTools().find((entry) => entry.tool.name === 'spineSceneInspect').tool;
    const finding = tool.outputs.properties.findings.items;
    assert.equal(tool.outputs.properties.nodeUuid.type[1], 'null');
    assert.equal(tool.outputs.properties.findings.maxItems, 1000);
    assert.equal(tool.outputs.properties.total.maximum, 1000);
    assert.equal(finding.properties.animations.maxItems, 1000);
    assert.equal(finding.properties.animations.items.properties.duration.type[0], 'number');
    assert.equal(finding.properties.tracks.items.properties.trackTime.type[0], 'number');
    assert.equal(finding.properties.slots.items.properties.attachmentType.type[0], 'string');
    assert.deepEqual(finding.required.slice(0, 6), ['node', 'component', 'defaultAnimation', 'animation', 'timeScale', 'loop']);
    assert.deepEqual(tool.outputs.required, ['nodeUuid', 'findings', 'total', 'truncated']);
  });
  it('returns bounded runtime animation tracks from a live Skeleton component', async () => {
    const previousCc = global.cc;
    class Skeleton {}
    const component = Object.assign(new Skeleton(), {
      timeScale: Number.NaN,
      skeletonData: { getRuntimeData: () => ({ animations: [{ name: 'idle', duration: 1.25 }, { name: 'walk', duration: 2 }] }) },
      _skeleton: {
        bones: [{ data: { name: 'root' }, worldX: 4, worldY: 5 }, { data: { name: 'arm' }, worldX: 6, worldY: 7 }],
        slots: [
          { data: { name: 'body' }, bone: { data: { name: 'root' } }, attachment: { name: 'body', constructor: { name: 'RegionAttachment' } } },
          { data: { name: 'armSlot' }, bone: { data: { name: 'arm' } }, attachment: null },
        ],
      },
      getState: () => ({ tracks: [
        { animation: { name: 'idle' }, loop: true, trackTime: 0.5, delay: 0, alpha: 1 },
        { animation: { name: 'walk' }, loop: false, trackTime: 1, delay: 0, alpha: 0.5 },
      ] }),
      sockets: [
        { path: 'body', target: { data: { name: 'root' } } },
        { path: 'arm', target: { data: { name: 'arm' } } },
      ],
    });
    global.cc = { director: { getScene: () => ({ uuid: 'scene', name: 'Scene', components: [component, component], children: [] }) } };
    try {
      const { methods } = requireDist('scene.js');
      const result = await methods.spineSceneInspect({ nodeUuid: 'scene', maxItems: 1 });
      assert.equal(result.total, 1);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].timeScale, null);
      assert.equal(result.truncated, true);
      assert.equal(result.findings[0].animations.length, 1);
      assert.equal(result.findings[0].bones.length, 1);
      assert.equal(result.findings[0].slots.length, 1);
      assert.equal(result.findings[0].tracks.length, 1);
      assert.equal(result.findings[0].sockets.length, 1);
      assert.deepEqual(result.findings[0].tracks, [{ index: 0, animation: 'idle', loop: true, trackTime: 0.5, delay: 0, alpha: 1 }]);
    } finally {
      global.cc = previousCc;
    }
  });
  it('fails closed when Creator omits required scene inspection metadata', async () => {
    const previousEditor = global.Editor;
    let response = { findings: [] };
    global.Editor = { Message: { request: async () => response } };
    try {
      const tools = new AnimationTools();
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = { findings: [{}], total: 1, truncated: false };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = { findings: [], total: 1, truncated: false };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = { nodeUuid: 7, findings: [], total: 0, truncated: false };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 'Skeleton',
          animations: [{ name: 42, duration: null }],
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: false,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 'Skeleton',
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          animations: new Array(1),
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: false,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 'Skeleton',
          defaultAnimation: 7,
          animation: null,
          timeScale: null,
          loop: null,
          animations: [],
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: false,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 7,
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          animations: [],
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: false,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: Array.from({ length: 1001 }, () => ({
          node: { id: null, name: null },
          component: 'Skeleton',
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          animations: [],
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        })),
        total: 1001,
        truncated: true,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 'Skeleton',
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          animations: Array.from({ length: 1001 }, () => ({ name: 'idle', duration: 1 })),
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: true,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [{
          node: { id: null, name: null },
          component: 'Skeleton',
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          animations: [{ name: 'idle', duration: 1 }, { name: 'walk', duration: 2 }],
          tracks: [],
          bones: [],
          slots: [],
          sockets: [],
          hasSkeletonData: false,
        }],
        total: 1,
        truncated: true,
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
      response = {
        nodeUuid: null,
        findings: [],
        total: 0,
        truncated: false,
        extra: 'unexpected',
      };
      await assert.rejects(
        () => tools.spineSceneInspect({ maxItems: 1 }),
        (error) => error.code === 'SPINE_SCENE_INSPECTION_FAILED' && error.status === 502,
      );
    } finally {
      global.Editor = previousEditor;
    }
  });
  it('forwards bounded node references and accepts a valid typed scene response', async () => {
    const previousEditor = global.Editor;
    let request;
    global.Editor = { Message: { request: async (...args) => {
      request = args;
      return {
        nodeUuid: 'node',
        findings: [{
          node: { id: 'node', name: 'Hero' },
          component: 'Skeleton',
          animations: [],
          tracks: [],
          bones: [],
          defaultAnimation: null,
          animation: null,
          timeScale: null,
          loop: null,
          slots: [],
          sockets: [],
          hasSkeletonData: true,
        }],
        total: 1,
        truncated: false,
      };
    } } };
    try {
      const result = await new AnimationTools().spineSceneInspect({ nodeReference: { id: 'node' }, maxItems: 3 });
      assert.equal(result.total, 1);
      assert.deepEqual(request, ['scene', 'execute-scene-script', {
        name: 'cc-bridge-3x',
        method: 'spineSceneInspect',
        args: [{ nodeUuid: 'node', maxItems: 3 }],
      }]);
    } finally {
      global.Editor = previousEditor;
    }
  });
  it('is cycle-safe and does not mark ordinary remaining nodes as truncated', async () => {
    const previousCc = global.cc;
    const target = { uuid: 'target', name: 'Target', components: [], children: [] };
    const scene = { uuid: 'scene', name: 'Scene', components: [], children: [] };
    scene.children.push(scene, target);
    global.cc = { director: { getScene: () => scene } };
    try {
      const { methods } = requireDist('scene.js');
      assert.equal(await methods.findRuntimeNodeUuid('target'), target);
      const result = await methods.spineSceneInspect({ nodeUuid: 'scene', maxItems: 1 });
      assert.equal(result.total, 0);
      assert.equal(result.truncated, false);
    } finally {
      global.cc = previousCc;
    }
  });
});
