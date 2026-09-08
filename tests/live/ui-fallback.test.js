'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck } = require('../helpers/utcp-client');

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

        const components = await postTool('nodeComponentsGet', { reference });
        assert.equal(components.ok, true, `${tool} components: ${JSON.stringify(components.body)}`);
        assert.ok(components.body.references.some((item) => item.type === component), `${tool} missing ${component}`);
      }
    } finally {
      for (const reference of created) {
        await postTool('nodeOperate', { operation: 'delete', reference });
      }
    }
  });
});
