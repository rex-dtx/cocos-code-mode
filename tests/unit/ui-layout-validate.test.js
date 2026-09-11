'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { buildUiLayoutValidate } = requireDist('ui-layout-validate.js');

const matrix = (x, y) => ({
  m00: 1, m01: 0, m02: 0, m03: 0, m04: 0, m05: 1, m06: 0, m07: 0,
  m08: 0, m09: 0, m10: 1, m11: 0, m12: x, m13: y, m14: 0, m15: 1,
});
const transform = (width, height, anchorPoint) => ({ type: 'cc.UITransform', contentSize: { width, height }, ...(anchorPoint ? { anchorPoint } : {}) });
const node = (uuid, name, components, children = [], x = 0, y = 0) => {
  const value = { uuid, name, components, children, active: true, worldMatrix: matrix(x, y) };
  for (const child of children) child.parent = value;
  return value;
};
const fixture = () => {
  const a = node('a', 'A', [transform(30, 30, { x: 0, y: 0 })], [], 10, 10);
  const b = node('b', 'B', [transform(30, 30)], [], 20, 20);
  const outside = node('outside', 'Outside', [transform(20, 20, { x: 0, y: 0 })], [], 95, 95);
  return node('root', 'Canvas', [{ type: 'cc.Canvas' }, transform(100, 100, { x: 0, y: 0 })], [a, b, outside]);
};

describe('uiLayoutValidate', () => {
  it('reports overlap, missing anchor, clipping, and safe-area violations', () => {
    const result = buildUiLayoutValidate(fixture(), {
      root: { id: 'root' },
      designResolution: { width: 100, height: 100 },
      viewport: { width: 100, height: 100 },
      safeArea: { rect: { x: 0, y: 0, width: 90, height: 90 } },
      maxNodes: 16,
      maxIssues: 16,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.complete, true);
    assert.equal(result.valid, false);
    const codes = new Set(result.issues.map((issue) => issue.code));
    assert.ok(codes.has('OVERLAP'));
    assert.ok(codes.has('ANCHOR_MISSING'));
    assert.ok(codes.has('SAFE_AREA_OUTSIDE') || codes.has('SAFE_AREA_CLIPPED'));
  });

  it('bounds issue output and returns typed input errors', () => {
    const bounded = buildUiLayoutValidate(fixture(), {
      root: { id: 'root' }, safeArea: { rect: { x: 0, y: 0, width: 50, height: 50 } }, maxIssues: 1,
    });
    assert.equal(bounded.issues.length, 1);
    assert.equal(bounded.truncated, true);
    assert.ok(bounded.truncation.some((item) => item.kind === 'issues'));
    const missing = buildUiLayoutValidate(fixture(), { safeArea: { rect: { x: 0, y: 0, width: 50, height: 50 } } });
    assert.equal(missing.error.code, 'UI_LAYOUT_VALIDATE_ROOT_REQUIRED');
    const invalid = buildUiLayoutValidate(fixture(), { root: { id: 'root' }, safeArea: { rect: { x: 0, y: 0, width: 0, height: 50 } } });
    assert.equal(invalid.error.code, 'UI_LAYOUT_VALIDATE_INVALID_INPUT');
  });
});
