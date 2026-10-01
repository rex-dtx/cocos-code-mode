'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function loadScene(scene) {
  const Widget = class Widget {};
  const cc = {
    Widget,
    Object: { Flags: { HideInHierarchy: 1 << 5 } },
    v2: (x, y) => ({ x, y }),
    director: { getScene: () => scene },
    engine: { getInstanceById: id => {
      const stack = [scene];
      while (stack.length) {
        const current = stack.pop();
        if (current.uuid === id) return current;
        stack.push(...current.children);
      }
      return null;
    } },
  };
  const source = fs.readFileSync(path.join(root, 'source/scene-script.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, cc, console, require, globalThis: { cc } });
  return { handlers: module.exports, Widget };
}
function makeNode(name, uuid, x, y, width, height, anchorX = 0.5, anchorY = 0.5) {
  return {
    name, uuid, x, y, width, height, anchorX, anchorY, active: true, _objFlags: 0, _is3DNode: false, children: [], parent: null,
    getContentSize() { return { width: this.width, height: this.height }; },
    getAnchorPoint() { return { x: this.anchorX, y: this.anchorY }; },
    getComponent(type) { return this.widget instanceof type ? this.widget : null; },
    convertToWorldSpaceAR(point) {
      let px = point.x; let py = point.y;
      let node = this;
      while (node) {
        const rad = (node.angle || 0) * Math.PI / 180;
        const sx = px * (node.scaleX || 1); const sy = py * (node.scaleY || 1);
        px = node.x + sx * Math.cos(rad) - sy * Math.sin(rad);
        py = node.y + sx * Math.sin(rad) + sy * Math.cos(rad);
        node = node.parent;
      }
      return { x: px, y: py };
    },
  };
}
function attach(parent, child) { child.parent = parent; parent.children.push(child); return child; }
function invoke(handler, opts) {
  return new Promise((resolve, reject) => handler({ reply: (err, value) => err ? reject(err) : resolve(value) }, opts));
}
function setup() {
  const scene = makeNode('Scene', 'scene', 0, 0, 0, 0);
  const canvas = attach(scene, makeNode('Canvas', 'canvas', 100, 200, 200, 100));
  const child = attach(canvas, makeNode('Button', 'button', 30, -10, 20, 10, 0, 0));
  const { handlers, Widget } = loadScene(scene);
  child.widget = Object.assign(new Widget(), {
    enabled: true, target: canvas, alignMode: 1, isAlignLeft: true, isAbsoluteLeft: false, left: 0.1,
    isAlignTop: true, isAbsoluteTop: true, top: 8,
  });
  return { scene, canvas, child, inspect: opts => invoke(handlers['ui-layout-inspect'], opts) };
}

function loadReadTool(inspect) {
  const file = fs.readFileSync(path.join(root, 'source/utcp/tools-2x/scene-read-tools.ts'), 'utf8');
  const code = ts.transpileModule(file, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
  } }).outputText;
  class ToolError extends Error { constructor(fields) { super(fields.message); this.code = fields.code; } }
  const module = { exports: {} };
  const mocks = {
    '../decorators': { utcpTool: () => () => {} },
    '../utils/ipc-promise': { sceneScript: async (name, args) => {
      assert.equal(name, 'ui-layout-inspect');
      return inspect(args);
    } },
    '../tool-error': { ToolError },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] });
  return { tool: new module.exports.SceneReadTools(), ToolError };
}

describe('Creator 2.4 read-only UI layout inspection', () => {
  it('returns the selected subtree with observed parent-child geometry and Widget constraints', async () => {
    const { canvas, child, inspect } = setup();
    const result = await inspect({ uuid: 'canvas', maxNodes: 2 });
    assert.equal(result.rootUuid, canvas.uuid);
    assert.equal(result.truncated, false);
    assert.equal(result.incomplete, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result.nodes.map(n => [n.uuid, n.path, n.parentUuid]))), [
      ['canvas', 'Canvas', null], ['button', 'Canvas/Button', 'canvas'],
    ]);
    assert.deepEqual({ ...result.nodes[0].worldRect }, { x: 0, y: 150, width: 200, height: 100 });
    assert.deepEqual({ ...result.nodes[1].worldRect }, { x: 130, y: 190, width: 20, height: 10 });
    assert.deepEqual({ ...result.nodes[1].worldPosition }, { x: 130, y: 190 });
    assert.deepEqual({ ...result.nodes[1].size }, { width: 20, height: 10 });
    assert.deepEqual({ ...result.nodes[1].anchor }, { x: 0, y: 0 });
    assert.equal(result.nodes[1].widget.targetUuid, canvas.uuid);
    assert.equal(result.nodes[1].widget.isAlignLeft, true);
    assert.equal(result.nodes[1].widget.isAbsoluteLeft, false);
    assert.equal(result.nodes[1].widget.left, 0.1);
    assert.equal(result.nodes[1].widget.top, 8);
    assert.equal(child.x, 30); assert.equal(child.y, -10);
  });
  it('uses transformed corners rather than inferring a rectangle from unrotated local coordinates', async () => {
    const { canvas, inspect } = setup();
    canvas.angle = 90;
    const result = await inspect({ uuid: 'canvas', maxNodes: 2 });
    assert.deepEqual({ ...result.nodes[1].worldRect }, { x: 100, y: 230, width: 10, height: 20 });
  });
  it('returns unknown geometry without a 2.4 world-coordinate conversion', async () => {
    const { child, inspect } = setup();
    delete child.convertToWorldSpaceAR;
    child.convertToWorldSpaceAR = undefined;
    const result = await inspect({ uuid: 'canvas', maxNodes: 2 });
    assert.equal(result.nodes[1].worldPosition, null);
    assert.equal(result.nodes[1].worldRect, null);
    assert.deepEqual({ ...result.nodes[1].size }, { width: 20, height: 10 });
  });
  it('does not project three-dimensional nodes into invented 2D geometry', async () => {
    const { child, inspect } = setup();
    child._is3DNode = true;
    const result = await inspect({ uuid: 'button', maxNodes: 1 });
    assert.equal(result.nodes[0].worldPosition, null);
    assert.equal(result.nodes[0].worldRect, null);
  });
  it('rejects invalid main-process inputs before scene IPC and fails closed on missing nodes', async () => {
    let calls = 0;
    const { tool, ToolError } = loadReadTool(() => { calls++; return null; });
    for (const args of [null, {}, { uuid: ' ' }, { uuid: 'canvas', maxNodes: 0 },
      { uuid: 'canvas', maxNodes: 129 }, { uuid: 'canvas', maxNodes: 1.5 },
      { uuid: 'canvas', maxNodes: '2' }, { uuid: 'canvas', extra: true }]) {
      await assert.rejects(tool.uiLayoutInspect(args), error => error instanceof ToolError && error.code === 'INVALID_ARGUMENT');
    }
    assert.equal(calls, 0);
    await assert.rejects(tool.uiLayoutInspect({ uuid: 'missing' }), error => error instanceof ToolError && error.code === 'TARGET_NOT_FOUND');
    assert.equal(calls, 1);
  });
  it('refuses incomplete Creator payloads rather than presenting a complete inventory', async () => {
    const { tool, ToolError } = loadReadTool(() => ({ rootUuid: 'canvas', nodes: [], maxNodes: 1, truncated: false, incomplete: false }));
    await assert.rejects(tool.uiLayoutInspect({ uuid: 'canvas', maxNodes: 1 }), error => error instanceof ToolError && error.code === 'UI_LAYOUT_INVALID_RESPONSE');
  });
  it('caps wide child queues while marking omitted siblings incomplete', async () => {
    const { canvas, inspect } = setup();
    for (let i = 0; i < 500; i++) attach(canvas, makeNode('Item', `item-${i}`, i, 0, 1, 1));
    const result = await inspect({ uuid: 'canvas', maxNodes: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(result.nodes.map(node => node.uuid))), ['canvas', 'button']);
    assert.equal(result.truncated, true);
    assert.equal(result.incomplete, true);
  });
  it('distinguishes an exact cap from a truncated subtree and refuses missing targets/invalid limits', async () => {
    const { canvas, inspect } = setup();
    assert.equal((await inspect({ uuid: canvas.uuid, maxNodes: 1 })).truncated, true);
    assert.equal((await inspect({ uuid: 'button', maxNodes: 1 })).truncated, false);
    assert.equal(await inspect({ uuid: 'missing', maxNodes: 1 }), null);
    for (const maxNodes of [0, -1, 1.5, 129, Infinity, NaN, '2']) {
      await assert.rejects(inspect({ uuid: canvas.uuid, maxNodes }), /maxNodes/);
    }
  });
});
