'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { requireDist } = require('../helpers/require-dist');

const { AnimationTools } = requireDist('utcp/tools/animation-tools.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');

let previousEditor;
let tempFile;
let tempAtlas;
afterEach(() => {
  global.Editor = previousEditor;
  previousEditor = undefined;
  if (tempFile) fs.rmSync(tempFile, { force: true });
  if (tempAtlas) fs.rmSync(tempAtlas, { force: true });
  tempFile = undefined;
  tempAtlas = undefined;
});

describe('Spine asset inspection', () => {
  it('returns bounded animations, durations, events, slots, skins, and sockets', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify({
      skeleton: { hash: 'hash', spine: '4.1' },
      bones: [{ name: 'root' }, { name: 'hand', parent: 'root' }],
      slots: [{ name: 'weapon', bone: 'hand', attachment: 'sword' }],
      skins: { default: { weapon: { sword: { type: 'region', path: 'sword', x: 2, y: 3, rotation: 15, width: 32, height: 64 } } } },
      events: { hit: { int: 1, string: 'impact' } },
      sockets: [{ name: 'weaponSocket', bone: 'hand' }],
      animations: { attack: { bones: { hand: { rotate: [{ time: 0.75, value: 20 }] } }, events: [{ name: 'hit', time: 0.5 }] } }
    }));
    tempAtlas = path.join(os.tmpdir(), `ccp-spine-${Date.now()}.atlas`);
    fs.writeFileSync(tempAtlas, 'hero.png\nsize: 1024,1024\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nsword\n  rotate: false\n  xy: 10, 20\n  size: 32, 64\n  orig: 32, 64\n  offset: 0, 0\n  index: -1\n\nhero2.png\nsize: 512,512\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nshield\n  rotate: false\n  xy: 4, 8\n  size: 16, 16\n  orig: 16, 16\n  offset: 0, 0\n  index: -1\n');
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async (_service, message) => {
      return { uuid: 'spine-uuid', type: 'sp.SkeletonData', importer: 'spine-data', url: 'db://assets/hero.json', file: tempFile, subAssets: { atlas: { uuid: 'atlas-uuid', url: 'db://assets/hero.atlas', type: 'sp.SpineAtlas', importer: 'spine-atlas', file: tempAtlas } } };
    } } };

    const result = await new AnimationTools().spineAssetInspect({ reference: { id: 'spine-uuid' } });
    assert.equal(result.source.format, 'spine-json');
    assert.equal(result.totalAnimations, 1);
    assert.equal(result.truncatedAnimations, false);
    assert.equal(result.totalEvents, 1);
    assert.equal(result.truncatedEvents, false);
    assert.equal(result.socketSupport, 'declared-in-source');
    const validation = await new AnimationTools().spineAssetValidate({ reference: { id: 'spine-uuid' } });
    assert.equal(validation.valid, true);
    assert.equal(validation.issues.length, 0);
    assert.equal(result.animations[0].name, 'attack');
    assert.equal(result.animations[0].duration, 0.75);
    assert.equal(result.animations[0].eventCount, 1);
    assert.equal(result.animations[0].timelines.counts.bones, 1);
    assert.equal(result.atlases.length, 1);
    assert.equal(result.atlases[0].pages[0].name, 'hero.png');
    assert.equal(result.atlases[0].pages.length, 2);
    assert.equal(result.atlases[0].regions[0].size, '32, 64');
    assert.equal(result.atlases[0].regions.length, 2);
    assert.deepEqual(result.slots[0], { name: 'weapon', bone: 'hand', attachment: 'sword' });
    assert.deepEqual(result.attachments.skins[0].slots[0].attachments, [{ name: 'sword', type: 'region', path: 'sword', x: 2, y: 3, rotation: 15, scaleX: null, scaleY: null, width: 32, height: 64, vertexCount: null, triangleCount: null }]);
    assert.deepEqual(result.constraints, { ik: [], transform: [], path: [], physics: [] });
    assert.equal(result.linkedAssets.length, 1);
    assert.deepEqual(result.skins, [{ name: 'default', slotCount: 1, slots: [{ name: 'weapon', attachmentCount: 1, attachments: [{ name: 'sword', type: 'region', path: 'sword', x: 2, y: 3, rotation: 15, scaleX: null, scaleY: null, width: 32, height: 64, vertexCount: null, triangleCount: null }], truncated: false }], truncated: false }]);
    assert.deepEqual(result.sockets, [{ name: 'weaponSocket', bone: 'hand' }]);
  });
  it('returns a focused bounded Spine atlas inventory', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-atlas-${Date.now()}.json`);
    tempAtlas = path.join(os.tmpdir(), `ccp-spine-atlas-${Date.now()}.atlas`);
    fs.writeFileSync(tempFile, JSON.stringify({ bones: [{ name: 'root' }], animations: {} }));
    fs.writeFileSync(tempAtlas, 'hero.png\nsize: 32,32\n\nbody\n  size: 16, 16\n');
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async () => ({ uuid: 'spine-atlas', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, subAssets: { atlas: { uuid: 'atlas', type: 'sp.SpineAtlas', file: tempAtlas } } }) } };
    const result = await new AnimationTools().spineAtlasInspect({ reference: { id: 'spine-atlas' }, maxItems: 10 });
    assert.equal(result.totalPages, 1);
    assert.equal(result.totalRegions, 1);
    assert.equal(result.truncated, false);
  });
  it('returns focused Spine skin and attachment metadata', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-attachments-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify({ bones: [{ name: 'root' }], skins: { default: { body: { hero: { type: 'region', path: 'hero' } } } }, animations: {} }));
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async () => ({ uuid: 'spine-attachments', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, subAssets: {} }) } };
    const result = await new AnimationTools().spineAttachmentInspect({ reference: { id: 'spine-attachments' } });
    assert.equal(result.totalSkins, 1);
    assert.equal(result.skins[0].slots[0].attachments[0].name, 'hero');
  });
  it('registers bounded Spine socket inspection', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/animation-tools.ts'), 'utf8');
    assert.match(source, /'spineSocketInspect'/);
    assert.match(source, /target bone paths/);
  });
  it('registers bounded Spine event inspection', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/animation-tools.ts'), 'utf8');
    assert.match(source, /'spineEventInspect'/);
    assert.match(source, /totalUsages/);
  });
  it('registers Spine event validation', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/animation-tools.ts'), 'utf8');
    assert.match(source, /'spineEventValidate'/);
    assert.match(source, /ANIMATION_EVENT_UNDEFINED/);
  });
  it('registers bounded Spine skeleton inspection', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/animation-tools.ts'), 'utf8');
    assert.match(source, /'spineSkeletonInspect'/);
    assert.match(source, /linkedAssets/);
    assert.match(source, /constraintCount/);
  });
  it('registers Spine skeleton inspection route', () => {
    const names = ToolRegistry.getTools().map(({ tool }) => tool.name);
    assert.ok(names.includes('spineSkeletonInspect'));
  });
  it('registers Spine asset batch validation', () => {
    const names = ToolRegistry.getTools().map(({ tool }) => tool.name);
    assert.ok(names.includes('spineAssetBatchValidate'));
  });
  it('registers Spine asset batch inspection', () => {
    const names = ToolRegistry.getTools().map(({ tool }) => tool.name);
    assert.ok(names.includes('spineAssetBatchInspect'));
  });

  it('reports broken bone, attachment, event, and atlas relationships with bounded issues', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-invalid-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify({
      bones: [{ name: 'root' }],
      slots: [{ name: 'weapon', bone: 'missingBone', attachment: 'missingAttachment' }],
      skins: { default: { weapon: { sword: { type: 'region', path: 'missingRegion' } } } },
      events: {},
      sockets: [{ name: 'socket', bone: 'missingBone' }],
      animations: { attack: { events: [{ name: 'missingEvent', time: 0.1 }] } }
    }));
    tempAtlas = path.join(os.tmpdir(), `ccp-spine-invalid-${Date.now()}.atlas`);
    fs.writeFileSync(tempAtlas, 'hero.png\nsize: 32,32\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n\nsword\n  rotate: false\n  xy: 0, 0\n  size: 16, 16\n');
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async () => ({ uuid: 'invalid-spine', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, subAssets: { atlas: { file: tempAtlas, type: 'sp.SpineAtlas' } } }) } };
    const result = await new AnimationTools().spineAssetValidate({ reference: { id: 'invalid-spine' }, maxIssues: 3 });
    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 3);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.issues.map((issue) => issue.code), ['ATTACHMENT_ATLAS_REGION_MISSING', 'SOCKET_BONE_MISSING', 'SLOT_BONE_MISSING']);
  });

  it('reports duplicate bones and slots plus missing bone parents', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-hierarchy-${Date.now()}.json`);
    fs.writeFileSync(tempFile, JSON.stringify({
      bones: [{ name: 'root' }, { name: 'root' }, { name: 'child', parent: 'missingParent' }, { name: 'cycleA', parent: 'cycleB' }, { name: 'cycleB', parent: 'cycleA' }],
      slots: [{ name: 'weapon', bone: 'root' }, { name: 'weapon', bone: 'root' }],
      skins: {},
      events: { hit: {}, hit2: {} },
      sockets: [{ name: 'socket', bone: 'root' }, { name: 'socket', bone: 'root' }],
      ik: [{ name: 'aim', bones: ['missingConstraintBone'], target: 'missingTarget' }],
      animations: {}
    }));
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async () => ({ uuid: 'hierarchy-spine', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, subAssets: {} }) } };
    const result = await new AnimationTools().spineAssetValidate({ reference: { id: 'hierarchy-spine' }, maxIssues: 7 });
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues.map((issue) => issue.code), ['DUPLICATE_BONE_NAME', 'BONE_PARENT_MISSING', 'BONE_PARENT_CYCLE', 'DUPLICATE_SOCKET_NAME', 'DUPLICATE_SLOT_NAME', 'CONSTRAINT_BONE_MISSING', 'CONSTRAINT_TARGET_BONE_MISSING']);
    assert.equal(result.truncated, false);
  });

  it('fails closed for non-Spine assets and invalid source', async () => {
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async () => ({ uuid: 'asset', importer: 'fbx', file: 'missing' }) } };
    await assert.rejects(
      () => new AnimationTools().spineAssetInspect({ reference: { id: 'asset' } }),
      (error) => error.code === 'UNSUPPORTED_ASSET' && error.status === 422,
    );
  });

  it('uses Creator importer metadata for binary Spine sources', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-${Date.now()}.skel`);
    fs.writeFileSync(tempFile, Buffer.from([0, 1, 2, 3]));
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async (_service, message) => {
      if (message === 'query-asset-info') return { uuid: 'binary-spine', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, url: 'db://assets/hero.skel', subAssets: {} };
      if (message === 'query-asset-meta') return { userData: { bones: [{ name: 'root' }], slots: [], animations: { idle: {} } } };
      throw new Error(`unexpected message ${message}`);
    } } };

    const result = await new AnimationTools().spineAssetInspect({ reference: { id: 'binary-spine' } });
    assert.equal(result.source.format, 'spine-binary-import-metadata');
    assert.equal(result.totalAnimations, 1);
    assert.deepEqual(result.bones, [{ name: 'root', parent: null }]);
  });

  it('uses asset-db data when importer metadata is stored there', async () => {
    tempFile = path.join(os.tmpdir(), `ccp-spine-data-${Date.now()}.skel`);
    fs.writeFileSync(tempFile, Buffer.from([4, 5, 6, 7]));
    previousEditor = global.Editor;
    global.Editor = { Message: { request: async (_service, message) => {
      if (message === 'query-asset-info') return { uuid: 'binary-spine-data', type: 'sp.SkeletonData', importer: 'spine-data', file: tempFile, url: 'db://assets/data.skel', subAssets: {} };
      if (message === 'query-asset-data') return { data: { bones: [{ name: 'root' }], slots: [], animations: { idle: {} } } };
      throw new Error(`unexpected message ${message}`);
    } } };

    const result = await new AnimationTools().spineAssetInspect({ reference: { id: 'binary-spine-data' } });
    assert.equal(result.source.format, 'spine-binary-import-metadata');
    assert.equal(result.totalAnimations, 1);
  });
});
