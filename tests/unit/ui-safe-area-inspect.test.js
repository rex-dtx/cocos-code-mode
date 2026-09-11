'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { buildUiSafeAreaInspect } = requireDist('ui-safe-area-inspect.js');

const matrix = (x, y) => ({
  m00: 1, m01: 0, m02: 0, m03: 0, m04: 0, m05: 1, m06: 0, m07: 0,
  m08: 0, m09: 0, m10: 1, m11: 0, m12: x, m13: y, m14: 0, m15: 1,
});
const transform = (width, height, x, y) => ({
  type: 'cc.UITransform', contentSize: { width, height }, anchorPoint: { x: 0, y: 0 },
});
const node = (uuid, name, components, children = [], x = 0, y = 0) => {
  const result = { uuid, name, components, children, active: true, worldMatrix: matrix(x, y) };
  for (const child of children) child.parent = result;
  return result;
};
const scene = () => {
  const inside = node('inside', 'Inside', [transform(20, 20, 10, 10)], [], 10, 10);
  const outside = node('outside', 'Outside', [transform(20, 20, 90, 90)], [], 90, 90);
  const fullyOutside = node('fully-outside', 'FullyOutside', [transform(20, 20, -30, -30)], [], -30, -30);
  return node('root', 'Canvas', [{ type: 'cc.Canvas' }, transform(100, 100, 0, 0)], [inside, outside, fullyOutside]);
};

describe('uiSafeAreaInspect geometry and bounds contract', () => {
  it('reports inside and outside active nodes deterministically', () => {
    const result = buildUiSafeAreaInspect(scene(), {
      root: { id: 'root' },
      safeArea: { rect: { x: 0, y: 0, width: 100, height: 100 } },
      maxNodes: 8,
      maxIssues: 8,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.valid, false);
    assert.equal(result.complete, true);
    assert.equal(result.safeArea.rect.width, 100);
    assert.equal(result.nodes.find((item) => item.uuid === 'inside').inside, true);
    assert.equal(result.nodes.find((item) => item.uuid === 'outside').outside, true);
    assert.equal(result.issues[0].code, 'SAFE_AREA_CLIPPED');
    assert.equal(result.issues[0].nodeId, 'outside');
  });

  it('derives a root-relative safe rectangle from insets and bounds issue output', () => {
    const result = buildUiSafeAreaInspect(scene(), {
      root: { id: 'root' },
      safeArea: { insets: { top: 10, right: 10, bottom: 10, left: 10 } },
      maxNodes: 8,
      maxIssues: 1,
    });
    assert.equal(result.safeArea.rect.x, 10);
    assert.equal(result.safeArea.rect.y, 10);
    assert.equal(result.safeArea.rect.width, 80);
    assert.equal(result.issues.length, 1);
    assert.equal(result.truncation.length, 1);
    assert.equal(result.truncation[0].kind, 'issues');
    assert.equal(result.complete, false);
    assert.equal(result.valid, false);
  });

  it('returns typed errors for invalid bounds and missing roots without touching input nodes', () => {
    const root = scene();
    const invalid = buildUiSafeAreaInspect(root, { root: { id: 'root' }, safeArea: { rect: { x: 0, y: 0, width: 0, height: 100 } } });
    assert.equal(invalid.error.code, 'UI_SAFE_AREA_INVALID_INPUT');
    const missing = buildUiSafeAreaInspect(root, { root: { id: 'missing' }, safeArea: { rect: { x: 0, y: 0, width: 100, height: 100 } } });
    assert.equal(missing.error.code, 'UI_SAFE_AREA_ROOT_NOT_FOUND');
    assert.equal(root.children.length, 3);
    assert.equal(root.children[0].name, 'Inside');
  });
});
