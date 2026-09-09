'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const {
  aabbFromCorners,
  buildUiLayoutReport,
  localCorners,
  resolveFit,
  transformCorners,
} = requireDist('ui-layout-report.js');

const matrix = (m00, m01, m04, m05, m12, m13) => ({
  m00, m01, m02: 0, m03: 0, m04, m05, m06: 0, m07: 0,
  m08: 0, m09: 0, m10: 1, m11: 0, m12, m13, m14: 0, m15: 1,
});
const transform = (width, height, anchor, worldMatrix, extras = {}) => ({
  type: 'cc.UITransform', contentSize: { width, height }, anchorPoint: anchor, ...extras,
});
const node = (uuid, name, components, children = [], extras = {}) => {
  const result = { uuid, name, components, children, active: true, worldMatrix: matrix(1, 0, 0, 1, 0, 0), ...extras };
  for (const child of children) child.parent = result;
  return result;
};
const request = (extra = {}) => ({
  root: { id: 'root' }, designResolution: { width: 100, height: 100 }, viewport: { width: 200, height: 100 }, fitMode: 'contain', ...extra,
});

describe('uiLayoutReport geometry and bounded diagnostics', () => {
  it('transforms anchored corners through a rotated/scaled world matrix and maps viewport fit', () => {
    const corners = localCorners({ width: 20, height: 10 }, { x: 0.25, y: 0.5 });
    const world = transformCorners(corners, matrix(0, 2, -2, 0, 30, 40));
    assert.deepEqual(world, [{ x: 40, y: 30 }, { x: 40, y: 70 }, { x: 20, y: 70 }, { x: 20, y: 30 }]);
    assert.deepEqual(aabbFromCorners(world), { x: 20, y: 30, width: 20, height: 40 });
    const fit = resolveFit({ width: 100, height: 100 }, { width: 200, height: 100 }, 'contain');
    assert.deepEqual(fit.scale, { x: 1, y: 1 });
    assert.deepEqual(fit.offset, { x: 50, y: 0 });
  });

  it('keeps UI inventory while filtering ordinary scene descendants and inactive findings', () => {
    const inactive = node('inactive', 'Inactive', [transform(0, 0, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 1000, 1000))], [], { active: false, activeInHierarchy: false });
    const label = node('label', 'Label', [transform(10, 10, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 10, 10))]);
    const ordinary = node('ordinary', 'Camera', [], [inactive]);
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))], [ordinary, label]);
    const report = buildUiLayoutReport(root, request());
    assert.equal(report.error, undefined);
    assert.deepEqual(report.nodes.map((item) => item.uuid), ['root', 'inactive', 'label']);
    assert.equal(report.nodes.find((item) => item.uuid === 'inactive').active, false);
    assert.equal(report.issues.some((item) => item.nodeId === 'inactive'), false);
    assert.equal(report.issues.some((item) => item.code === 'UITransform_MISSING'), false);
  });

  it('returns deterministic root errors and explicit truncation', () => {
    const child = node('child', 'Child', [transform(10, 10, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 10, 10))]);
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))], [child]);
    const truncated = buildUiLayoutReport(root, request({ maxNodes: 1 }));
    assert.equal(truncated.complete, false);
    assert.ok(truncated.truncation.some((item) => item.kind === 'nodes'));
    assert.equal(buildUiLayoutReport(root, request({ root: { id: 'missing' } })).error.code, 'UI_LAYOUT_ROOT_NOT_FOUND');
    const nonUi = node('camera', 'Camera', []);
    assert.equal(buildUiLayoutReport(nonUi, request({ root: { id: 'camera' } })).error.code, 'UI_LAYOUT_ROOT_NOT_UI');
  });

  it('identifies class names over enum-valued component.type and evaluates parent constraints', () => {
    const layout = { type: 1, spacingX: 5, constructor: { name: 'Layout' } };
    const childA = node('a', 'Same', [transform(10, 10, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 10, 10))], [], { worldMatrix: matrix(1, 0, 0, 1, 10, 10) });
    const childB = node('b', 'Same', [transform(10, 10, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 30, 10))], [], { worldMatrix: matrix(1, 0, 0, 1, 30, 10) });
    const childC = node('c', 'Third', [transform(10, 10, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 55, 10))], [], { worldMatrix: matrix(1, 0, 0, 1, 55, 10) });
    const parent = node('parent', 'Parent', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0)), layout], [childA, childB, childC]);
    const root = node('root', 'Canvas', [{ __classname__: 'cc.Canvas' }, transform(200, 200, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))], [parent]);
    const report = buildUiLayoutReport(root, request());
    assert.equal(report.error, undefined);
    const parentEntry = report.nodes.find((item) => item.uuid === 'parent');
    assert.ok(parentEntry.components.includes('Layout'));
    assert.equal(parentEntry.constraints.layout.type, 1);
    assert.ok(report.issues.some((item) => item.code === 'LAYOUT_GAP_INCONSISTENT'));
    assert.ok(report.issues.some((item) => item.code === 'LAYOUT_CONSTRAINT_VIOLATION'));
    const samePaths = report.nodes.filter((item) => item.name === 'Same').map((item) => item.path);
    assert.equal(new Set(samePaths).size, 2);
  });

  it('uses design units for active Widget flags and reports fully outside clipping', () => {
    const widget = { constructor: { name: 'Widget' }, left: 10, isAlignLeft: false, right: 99, isAlignRight: false };
    const child = node('child', 'Widget', [transform(20, 20, { x: 0.5, y: 0.5 }, matrix(2, 0, 0, 2, 100, 100)), widget], [], { worldMatrix: matrix(2, 0, 0, 2, 100, 100) });
    const mask = node('mask', 'Mask', [transform(20, 20, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 10, 10)), { constructor: { name: 'Mask' } }], [child], { worldMatrix: matrix(1, 0, 0, 1, 10, 10) });
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0)), { __classname__: 'cc.Canvas' }], [mask]);
    const report = buildUiLayoutReport(root, request());
    assert.equal(report.error, undefined);
    assert.equal(report.issues.some((item) => item.code === 'WIDGET_CONSTRAINT_VIOLATION'), false);
    const clipped = report.issues.find((item) => item.code === 'CLIPPED_BY_ANCESTOR');
    assert.equal(clipped.evidence.fullyOutside, true);
  });

  it('clips only the ScrollView view subtree and bounds response bytes', () => {
    const content = node('content', 'Content', [transform(100, 40, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 50, 20))], [], { worldMatrix: matrix(1, 0, 0, 1, 50, 20) });
    const view = node('view', 'View', [transform(40, 40, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 20, 20))], [content], { worldMatrix: matrix(1, 0, 0, 1, 20, 20) });
    const scrollbar = node('scrollbar', 'Scrollbar', [transform(10, 40, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 100, 20))], [], { worldMatrix: matrix(1, 0, 0, 1, 100, 20) });
    const scroll = node('scroll', 'Scroll', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0)), { constructor: { name: 'ScrollView' }, view: { uuid: 'view' }, content: { uuid: 'content' }, horizontal: false, vertical: true }], [view, scrollbar]);
    const root = node('root', 'Canvas', [transform(200, 200, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0)), { __classname__: 'cc.Canvas' }], [scroll]);
    const report = buildUiLayoutReport(root, request({ maxBytes: 20000 }));
    assert.equal(report.error, undefined);
    assert.ok(report.issues.some((item) => item.code === 'SCROLLVIEW_CONSTRAINT_VIOLATION'));
    assert.ok(report.issues.some((item) => item.code === 'CLIPPED_BY_ANCESTOR' && item.nodeId === 'content'));
    assert.equal(report.issues.some((item) => item.code === 'CLIPPED_BY_ANCESTOR' && item.nodeId === 'scrollbar'), false);
  });

  it('does not truncate when only ordinary descendants remain', () => {
    const ordinary = node('ordinary', 'Camera', [], [node('nested', 'NestedCamera', [])]);
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))], [ordinary]);
    const report = buildUiLayoutReport(root, request({ maxNodes: 1 }));
    assert.equal(report.error, undefined);
    assert.equal(report.complete, true);
    assert.deepEqual(report.nodes.map((item) => item.uuid), ['root']);
  });
  it('keeps the serialized report within maxBytes despite long root names', () => {
    const root = node('root', 'R'.repeat(5000), [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))]);
    const report = buildUiLayoutReport(root, request({ maxBytes: 2048 }));
    assert.ok(Buffer.byteLength(JSON.stringify(report), 'utf8') <= 2048);
  });
  it('reports overlap as advisory and returns a bounded PNG overlay after cleanup', () => {
    const a = node('a', 'A', [transform(20, 20, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 20, 20))]);
    const b = node('b', 'B', [transform(20, 20, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 25, 25))]);
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))], [a, b]);
    const oldDocument = global.document;
    const children = [];
    const body = { children, appendChild(canvas) { children.push(canvas); canvas.parentNode = body; }, removeChild(canvas) { children.splice(children.indexOf(canvas), 1); canvas.parentNode = null; } };
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    let drawCalls = 0;
    global.document = {
      body,
      createElement() {
        return {
          style: {},
          setAttribute() {},
          getContext() {
            return {
              beginPath() { drawCalls++; }, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
              arc() { drawCalls++; }, fill() {}, fillText() {},
            };
          },
          toDataURL() { return `data:image/png;base64,${png}`; },
        };
      },
    };
    try {
      const report = buildUiLayoutReport(root, request({ overlay: true }));
      const overlap = report.issues.find((item) => item.code === 'OVERLAP');
      assert.equal(overlap.severity, 'advisory');
      assert.equal(report.overlay.valid, true);
      assert.equal(report.overlay.rendered, true);
      assert.equal(report.overlay.cleaned, true);
      assert.equal(report.overlay.artifact.mimeType, 'image/png');
      assert.equal(report.overlay.artifact.encoding, 'base64');
      assert.equal(report.overlay.artifact.data, png);
      assert.equal(report.overlay.artifact.byteLength, Buffer.from(png, 'base64').length);
      assert.equal(report.overlay.sourceNodeCount, report.nodes.length);
      assert.equal(report.overlay.sourceIssueCount, report.issues.length);
      assert.ok(drawCalls >= report.nodes.length + 1, 'overlay draws geometry and issue markers');
      assert.equal(children.length, 0, 'overlay does not leave a DOM node behind');
      assert.ok(report.overlay.responseBytes <= report.overlay.maxResponseBytes);
    } finally { global.document = oldDocument; }
  });

  it('returns explicit overlay failure when PNG encoding is unavailable', () => {
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))]);
    const oldDocument = global.document;
    global.document = { createElement() { return { getContext() { return {}; } }; } };
    try {
      const report = buildUiLayoutReport(root, request({ overlay: true }));
      assert.equal(report.overlay.valid, false);
      assert.equal(report.overlay.rendered, false);
      assert.equal(report.overlay.cleaned, true);
      assert.equal(report.overlay.error.code, 'OVERLAY_ENCODING_UNAVAILABLE');
      assert.equal(report.overlay.artifact, undefined);
    } finally { global.document = oldDocument; }
  });

  it('rejects an oversized overlay payload with explicit byte accounting', () => {
    const root = node('root', 'Canvas', [transform(100, 100, { x: 0.5, y: 0.5 }, matrix(1, 0, 0, 1, 0, 0))]);
    const oldDocument = global.document;
    const huge = Buffer.alloc(300 * 1024, 0);
    huge.set([137, 80, 78, 71, 13, 10, 26, 10]);
    global.document = {
      createElement() {
        return {
          getContext() { return { beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {} }; },
          toDataURL() { return `data:image/png;base64,${huge.toString('base64')}`; },
        };
      },
    };
    try {
      const report = buildUiLayoutReport(root, request({ overlay: true, maxBytes: 4096 }));
      assert.equal(report.overlay.valid, false);
      assert.equal(report.overlay.error.code, 'OVERLAY_ARTIFACT_LIMIT_EXCEEDED');
      assert.equal(report.overlay.error.evidence.maxArtifactBytes, 4096);
      assert.equal(report.overlay.artifact, undefined);
      assert.ok(report.overlay.responseBytes <= report.overlay.maxResponseBytes);
    } finally { global.document = oldDocument; }
  });
});
