'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: uiResponsivePreview candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('projects live UI geometry across bounded resolutions and rejects missing roots', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const canvas = await getJson('/tools/nodeGetAtPath?hierarchyPath=Canvas');
    assert.equal(canvas.status, 200, JSON.stringify(canvas.body));
    assert.equal(canvas.body.references.length, 1);
    const id = canvas.body.references[0].id;
    const query = `/tools/uiResponsivePreview?reference%5Bid%5D=${encodeURIComponent(id)}&resolutions%5B0%5D%5Bwidth%5D=1280&resolutions%5B0%5D%5Bheight%5D=720&resolutions%5B1%5D%5Bwidth%5D=720&resolutions%5B1%5D%5Bheight%5D=1280`;
    const preview = await getJson(query);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.supported, true);
    assert.equal(preview.body.stable, true);
    assert.equal(preview.body.comparisons.length, 2);
    assert.deepEqual(preview.body.comparisons[1].scale, { x: 0.5625, y: 1280 / 720 });
    assert.match(preview.body.caveat, /projections, not rendered screenshots/);
    const missing = await getJson('/tools/uiResponsivePreview?reference%5Bid%5D=__missing_responsive_root__&resolutions%5B0%5D%5Bwidth%5D=1280&resolutions%5B0%5D%5Bheight%5D=720');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
  });
});
