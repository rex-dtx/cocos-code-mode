'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

const { buildUiAccessibilityAudit } = requireDist('ui-accessibility-audit.js');

const matrix = () => ({
  m00: 1, m01: 0, m02: 0, m03: 0, m04: 0, m05: 1, m06: 0, m07: 0,
  m08: 0, m09: 0, m10: 1, m11: 0, m12: 0, m13: 0, m14: 0, m15: 1,
});
const uiTransform = () => ({ type: 'cc.UITransform', contentSize: { width: 100, height: 30 }, anchorPoint: { x: 0.5, y: 0.5 } });
const node = (uuid, name, components, children = [], active = true) => {
  const result = { uuid, name, components: [uiTransform(), ...components], children, active, worldMatrix: matrix() };
  for (const child of children) child.parent = result;
  return result;
};
const label = (uuid, text) => node(uuid, `${uuid}-label`, [{ type: 'cc.Label', string: text }]);
const fixture = () => {
  const save = node('save', 'SaveButton', [{ type: 'cc.Button', interactable: true }], [label('save-label', 'Save')]);
  const saveAgain = node('save-again', 'SaveAgain', [{ type: 'cc.Toggle', interactable: true }], [label('save-label-2', ' save ')]);
  const unnamed = node('unnamed', '', [{ type: 'cc.Slider', interactable: true }]);
  const disabled = node('disabled', 'Disabled', [{ type: 'cc.Button', interactable: false }]);
  const inactive = node('inactive', 'Inactive', [{ type: 'cc.EditBox', placeholder: 'Email' }], [], false);
  return node('root', 'Canvas', [{ type: 'cc.Canvas' }], [save, saveAgain, unnamed, disabled, inactive]);
};

describe('uiAccessibilityAudit', () => {
  it('reports active nodes with inferred labels, roles, and known interactability', () => {
    const result = buildUiAccessibilityAudit(fixture(), { root: { id: 'root' }, maxNodes: 20, maxIssues: 20 });
    assert.equal(result.error, undefined);
    assert.equal(result.checkedNodes, 7);
    assert.equal(result.nodes.some((item) => item.uuid === 'inactive'), false);
    assert.deepEqual(
      result.nodes.find((item) => item.uuid === 'save'),
      {
        uuid: 'save', path: 'Canvas/SaveButton[save]', name: 'SaveButton', active: true,
        role: 'button', label: 'Save', labelSource: 'descendant-label', interactable: true,
        interactionComponent: 'cc.Button', components: ['cc.UITransform', 'cc.Button'],
      },
    );
    assert.equal(result.nodes.find((item) => item.uuid === 'disabled').interactable, false);
    assert.deepEqual(result.issues.map((item) => item.code), ['MISSING_ACCESSIBLE_LABEL', 'DUPLICATE_ACCESSIBLE_LABEL']);
    assert.deepEqual(result.issues[1].relatedNodeIds, ['save-again']);
    assert.equal(result.valid, false);
    assert.equal(result.complete, true);
  });

  it('bounds active-node and issue output deterministically', () => {
    const nodeLimited = buildUiAccessibilityAudit(fixture(), { root: { id: 'root' }, maxNodes: 2, maxIssues: 20 });
    assert.equal(nodeLimited.checkedNodes, 2);
    assert.equal(nodeLimited.complete, false);
    assert.equal(nodeLimited.truncated, true);
    assert.equal(nodeLimited.truncation[0].kind, 'nodes');
    assert.equal(nodeLimited.truncation[0].limit, 2);

    const issueLimited = buildUiAccessibilityAudit(fixture(), { root: { id: 'root' }, maxNodes: 20, maxIssues: 1 });
    assert.equal(issueLimited.issues.length, 1);
    assert.equal(issueLimited.truncation[0].kind, 'issues');
    assert.equal(issueLimited.valid, false);
  });

  it('returns typed root and input errors without changing the scene', () => {
    const scene = fixture();
    assert.equal(buildUiAccessibilityAudit(scene, {}).error.code, 'UI_ACCESSIBILITY_ROOT_REQUIRED');
    assert.equal(buildUiAccessibilityAudit(scene, { root: { id: 'root' }, rootPath: 'Canvas' }).error.code, 'UI_ACCESSIBILITY_INVALID_INPUT');
    assert.equal(buildUiAccessibilityAudit(scene, { root: { id: 'missing' } }).error.code, 'UI_ACCESSIBILITY_ROOT_NOT_FOUND');
    assert.equal(buildUiAccessibilityAudit(scene, { root: { id: 'root' }, maxNodes: 0 }).error.code, 'UI_ACCESSIBILITY_INVALID_INPUT');
    assert.equal(scene.children.length, 5);
    assert.equal(scene.children[0].name, 'SaveButton');
  });

  it('registers a strict GET tool routed only through the named scene method', () => {
    const source = readSource('utcp/tools/ui-tools.ts');
    const start = source.indexOf("'uiAccessibilityAudit'");
    const end = source.indexOf("'uiSafeAreaInspect'", start);
    const slice = source.slice(start, end);
    assert.match(slice, /additionalProperties: false/);
    assert.match(slice, /'GET'/);
    assert.match(slice, /method: 'uiAccessibilityAudit'/);
    assert.doesNotMatch(slice, /executeJavascript|runCode|generic route/i);
    assert.match(slice, /does not provide or verify screen-reader runtime support/);
  });
});
