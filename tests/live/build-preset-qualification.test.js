'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: buildPresetAudit candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('validates a public target profile without dispatching a build', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const valid = await postTool('buildPresetAudit', {
      platform: 'web-mobile', options: { orientation: 'landscape' },
    });
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.equal(valid.body.valid, true);
    assert.equal(valid.body.complete, true);
    assert.deepEqual(valid.body.errors, []);
    const invalid = await postTool('buildPresetAudit', {
      platform: 'web-mobile', options: { unknownOption: true },
    });
    assert.equal(invalid.status, 200, JSON.stringify(invalid.body));
    assert.equal(invalid.body.valid, false);
    assert.deepEqual(invalid.body.unknownOptions, ['unknownOption']);
    assert.equal(invalid.body.errors[0].code, 'UNKNOWN_OPTION');
  });
});
