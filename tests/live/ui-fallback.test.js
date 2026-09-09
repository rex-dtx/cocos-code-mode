'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: CC373 native UI creation fallback', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('creates Label, Button, and Sprite without internal UI prefabs', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = [];
    try {
      for (const [tool, component] of [['createLabel', 'cc.Label'], ['createButton', 'cc.Button'], ['createSprite', 'cc.Sprite']]) {
        const result = await postTool(tool, {});
        assert.equal(result.ok, true, `${tool}: ${JSON.stringify(result.body)}`);
        const reference = result.body?.reference;
        assert.equal(typeof reference?.id, 'string');
        created.push(reference);

        const components = await getJson(`/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
        assert.equal(components.ok, true, `${tool} components: ${JSON.stringify(components.body)}`);
        assert.ok(components.body.references.some((item) => item.type === component), `${tool} missing ${component}`);
      }
    } finally {
      for (const reference of created) {
        await postTool('nodeOperate', { operation: 'delete', reference });
      }
    }
  });

  it('Creator 3.7 node lifecycle, component, inspector, reset, and lock APIs round-trip', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const created = await postTool('nodeCreate', { name: '__ccb3x_qualification_node__' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    const reference = created.body.reference;
    assert.equal(typeof reference?.id, 'string');

    try {
      const locked = await postTool('nodeOperate', { operation: 'lock', reference });
      assert.equal(locked.ok, true);
      assert.equal(locked.body.success, true);

      const unlocked = await postTool('nodeOperate', { operation: 'unlock', reference });
      assert.equal(unlocked.ok, true);
      assert.equal(unlocked.body.success, true);

      const set = await postTool('inspectorSet', {
        target: 'instance',
        reference,
        propertyPath: 'active',
        value: false,
      });
      assert.equal(set.ok, true);
      assert.equal(set.body.success, true);

      const added = await postTool('nodeComponentManage', {
        operation: 'add',
        reference,
        componentType: 'cc.Label',
      });
      assert.equal(added.ok, true);
      assert.equal(typeof added.body.reference?.id, 'string');

      const removed = await postTool('nodeComponentManage', {
        operation: 'remove',
        reference: added.body.reference,
      });
      assert.equal(removed.ok, true);
      assert.equal(removed.body.success, true);

      const reset = await postTool('nodeReset', {
        operation: 'property',
        references: [reference],
        propertyPath: 'active',
      });
      assert.equal(reset.ok, true);
      assert.equal(reset.body.success, true);
    } finally {
      await postTool('nodeOperate', { operation: 'delete', reference });
    }

    for (const [tool, body] of [
      ['nodeCreate', {}],
      ['nodeOperate', { operation: 'lock' }],
      ['inspectorSet', { target: 'instance', propertyPath: 'active', value: true }],
      ['nodeComponentManage', { operation: 'add', reference }],
      ['nodeReset', { operation: 'property' }],
    ]) {
      const invalid = await postTool(tool, body);
      assert.equal(invalid.status, 400, `${tool}: ${JSON.stringify(invalid.body)}`);
    }
  });
});
