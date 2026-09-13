'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: referenceImageManage candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('sets, inspects, and clears a project reference image with read-back', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const imagePath = 'db://assets/cc-release-slot/cc30-fortune-goat-9664/data/9664_MainUI/9664_ui_loading_bg.png';
    try {
      const set = await postTool('referenceImageManage', { operation: 'set', imagePath });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(set.body.supported, true);
      assert.equal(set.body.persisted, true);
      assert.equal(set.body.imagePath, imagePath);
      const inspect = await postTool('referenceImageManage', { operation: 'inspect' });
      assert.equal(inspect.status, 200, JSON.stringify(inspect.body));
      assert.equal(inspect.body.persisted, true);
      assert.equal(inspect.body.imagePath, imagePath);
      const missing = await postTool('referenceImageManage', { operation: 'set', imagePath: 'db://assets/__missing_reference_image__.png' });
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
    } finally {
      const clear = await postTool('referenceImageManage', { operation: 'clear' });
      assert.equal(clear.status, 200, JSON.stringify(clear.body));
      assert.equal(clear.body.persisted, true);
    }
  });
});
