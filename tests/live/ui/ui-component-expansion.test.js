'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  getJson,
  postTool,
  repeatTestcase,
  healthCheck,
  getCanvasReference,
} = require('../../helpers/utcp-client');

const nativeIt = it;
function repeatedIt(name, callback) {
  const testId = String(name).match(/^([A-Z0-9-]+)/)?.[1] || 'UI';
  return nativeIt(name, async (t) => repeatTestcase(testId, async () => callback(t)));
}

const fixtureName = (suffix) => `__ccb3x_ui_expansion_${suffix}_${process.pid}__`;

async function deleteNode(reference) {
  if (!reference?.id) return;
  const deleted = await postTool('nodeOperate', { operation: 'delete', reference });
  assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
}

async function componentsOf(reference) {
  const result = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
  assert.equal(result.ok, true, JSON.stringify(result.body));
  return result.body.references;
}

const componentCases = [
  { id: 'UI-C01', uiType: 'Label', expected: ['cc.Label'], properties: [['string', 'Label probe']] },
  { id: 'UI-C02', uiType: 'Button', expected: ['cc.Button'], properties: [['interactable', true]] },
  { id: 'UI-C03', uiType: 'EditBox', expected: ['cc.EditBox'], properties: [['string', 'EditBox probe'], ['placeholder', 'Type here']] },
  { id: 'UI-L01', uiType: 'Layout', expected: ['cc.Layout'], properties: [['spacingX', 12], ['spacingY', 8]] },
  { id: 'UI-N03', uiType: 'PageView', expected: ['cc.PageView'], properties: [['direction', 0]] },
  { id: 'UI-C05', uiType: 'ProgressBar', expected: ['cc.ProgressBar'], properties: [['progress', 0.65]] },
  { id: 'UI-R01', uiType: 'RichText', expected: ['cc.RichText'], properties: [['string', '[color=#22AAEE]RichText[/color] probe']] },
  { id: 'UI-N01', uiType: 'ScrollView', expected: ['cc.ScrollView'], properties: [['horizontal', true], ['vertical', false]] },
  { id: 'UI-C04', uiType: 'Slider', expected: ['cc.Slider'], properties: [['progress', 0.35]] },
  { id: 'UI-C03B', uiType: 'Toggle', expected: ['cc.Toggle'], properties: [['isChecked', true]] },
  { id: 'UI-C07', uiType: 'ToggleGroup', expected: ['cc.ToggleContainer'], properties: [['allowSwitchOff', true]] },
  { id: 'UI-R07', uiType: 'VideoPlayer', expected: ['cc.VideoPlayer'], properties: [['volume', 0.5], ['mute', true]] },
  { id: 'UI-R08', uiType: 'WebView', expected: ['cc.WebView'], properties: [['url', 'https://example.com/']] },
  { id: 'UI-L03', uiType: 'Widget', expected: ['cc.Widget'], properties: [['alignMode', 0]] },
];

describe('live: expanded UI component creation and identity', { concurrency: false }, () => {
  let health;

  before(async () => { health = await healthCheck(); });

  repeatedIt('UI-F08 creates a real Canvas component on a disposable UI root', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    let reference;
    try {
      const created = await postTool('createUiNode', { uiType: 'Widget', name: fixtureName('canvas') });
      assert.equal(created.ok, true, JSON.stringify(created.body));
      reference = created.body.reference;
      const added = await postTool('nodeComponentManage', {
        operation: 'add',
        reference,
        componentType: 'cc.Canvas',
      });
      assert.equal(added.ok, true, JSON.stringify(added.body));
      assert.equal(added.body.reference.type, 'cc.Canvas');
      const components = await componentsOf(reference);
      assert.ok(components.some((item) => item.type === 'cc.Canvas'));
      assert.ok(components.some((item) => item.type === 'cc.UITransform'));
    } finally {
      await deleteNode(reference);
    }
  });
  for (const testCase of componentCases) {
    repeatedIt(`${testCase.id} creates a real ${testCase.uiType} component, positions it randomly, and mutates representative state`, async (t) => {
      if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
      const canvas = await getCanvasReference();
      if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
      let reference;
      try {
        const created = await postTool('createUiNode', {
          uiType: 'Widget',
          name: fixtureName(testCase.uiType.toLowerCase()),
          parentReference: canvas,
        });
        assert.equal(created.ok, true, JSON.stringify(created.body));
        reference = created.body.reference;

        const x = Math.floor(Math.random() * 900) - 450;
        const y = Math.floor(Math.random() * 500) - 250;
        const positioned = await postTool('nodeBatchSet', {
          entries: [{ reference, propertyPaths: ['position.x', 'position.y'], values: [x, y] }],
        });
        assert.equal(positioned.ok, true, JSON.stringify(positioned.body));
        const positionReadBack = await postTool('sceneBatchGet', {
          entries: [{ target: 'instance', reference, fields: ['position'] }],
        });
        assert.equal(positionReadBack.ok, true, JSON.stringify(positionReadBack.body));
        assert.equal(positionReadBack.body.results[0].dump.position.x, x);
        assert.equal(positionReadBack.body.results[0].dump.position.y, y);

        const componentType = testCase.expected[0];
        const added = await postTool('nodeComponentManage', {
          operation: 'add',
          reference,
          componentType,
        });
        assert.equal(added.ok, true, JSON.stringify(added.body));
        const component = added.body.reference;
        assert.equal(component.type, componentType);

        if (testCase.properties.length > 0) {
          const mutated = await postTool('inspectorSet', {
            target: 'instance',
            reference: component,
            propertyPaths: testCase.properties.map(([path]) => path),
            values: testCase.properties.map(([, value]) => value),
          });
          assert.equal(mutated.ok, true, JSON.stringify(mutated.body));
          const readBack = await postTool('sceneBatchGet', {
            entries: [{
              target: 'instance',
              reference: component,
              fields: testCase.properties.map(([path]) => path),
            }],
          });
          assert.equal(readBack.ok, true, JSON.stringify(readBack.body));
          for (const [path, value] of testCase.properties) {
            assert.equal(readBack.body.results[0].dump[path], value, `${testCase.uiType}.${path} must read back`);
          }
        }
      } finally {
        await deleteNode(reference);
      }
    });
  }
});
