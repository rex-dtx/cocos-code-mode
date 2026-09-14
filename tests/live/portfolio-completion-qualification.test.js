'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck, getCanvasReference } = require('../helpers/utcp-client');

describe('live: bounded portfolio completion routes', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('audits scene-root asset usage and rejects malformed bounds', async (t) => {
    if (skipIfDown(t)) return;
    const query = `/tools/assetSceneUsageAudit?assetPath=${encodeURIComponent('db://assets/cc-release-slot/cc30-fortune-goat-9664')}&maxAssets=2&maxGraphAssets=5000&sceneReferences%5B0%5D%5Bid%5D=80dddede-15e3-4d8e-8f37-0f1263a0867c`;
    const audit = await getJson(query);
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.equal(audit.body.graphVersion, 'v4');
    assert.equal(audit.body.complete, true);
    assert.equal(audit.body.roots[0].id, '80dddede-15e3-4d8e-8f37-0f1263a0867c');
    const invalid = await getJson('/tools/assetSceneUsageAudit?maxAssets=0');
    assert.equal(invalid.status, 400);
  });


  it('materializes only the visible window under Canvas', async (t) => {
    if (skipIfDown(t)) return;
    const canvas = await getCanvasReference();
    if (!canvas) { t.skip('active scene has no Canvas fixture'); return; }
    const name = '__candidate_virtual_list__';
    let listReference;
    try {
      const list = await postTool('uiVirtualListCreate', {
        name,
        itemCount: 5,
        visibleItems: 2,
        parentReference: canvas,
      });
      assert.equal(list.status, 200, JSON.stringify(list.body));
      listReference = list.body.reference;
      assert.equal(list.body.itemCount, 5);
      assert.equal(list.body.instantiatedItems, 2);
      assert.equal(list.body.itemReferences.length, 2);
      assert.equal(list.body.virtualized, true);

      const found = await getJson(`/tools/findNodes?name=${encodeURIComponent(name)}&maxResults=1`);
      assert.equal(found.ok, true, JSON.stringify(found.body));
      assert.equal(found.body.nodes[0].reference.id, listReference.id);
      assert.match(found.body.nodes[0].path, /\/Canvas\/__candidate_virtual_list__$/);

      const invalid = await postTool('uiVirtualListCreate', {
        name: '__invalid_virtual_list__',
        itemCount: 1,
        visibleItems: 0,
        parentReference: canvas,
      });
      assert.equal(invalid.status, 400);
    } finally {
      if (listReference) {
        const deleted = await postTool('nodeOperate', { operation: 'delete', reference: listReference });
        assert.equal(deleted.ok, true, JSON.stringify(deleted.body));
      }
    }
  });
});
