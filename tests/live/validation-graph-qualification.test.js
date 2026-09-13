'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: validation and graph qualification', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  it('proves physics query compatibility and shader validation positive/negative paths', async (t) => {
    if (!health?.ok) { t.skip(health.reason); return; }
    for (const name of ['physics2dQuery', 'physics3dQuery']) {
      const r = await getJson(`/tools/${name}`);
      assert.ok([200, 404].includes(r.status), JSON.stringify(r.body));
      if (r.status === 200) assert.ok(Array.isArray(r.body.nodes));
    }
    const valid = await getJson('/tools/shaderValidate?effectName=builtin-standard');
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.equal(valid.body.valid, true);
    const invalid = await getJson('/tools/shaderValidate?effectName=__missing_effect__');
    assert.equal(invalid.status, 200);
    assert.equal(invalid.body.valid, false);
    assert.equal(invalid.body.diagnostics[0].code, 'EFFECT_NOT_FOUND');
  });
  it('proves JSON graph inspection and semantic validation', async (t) => {
    if (!health?.ok) { t.skip(health.reason); return; }
    const source = path.join(os.tmpdir(), `ccb3x-graph-${process.pid}.json`);
    fs.writeFileSync(source, JSON.stringify({ nodes: [{ id: 'idle' }, { id: 'run' }], transitions: [{ from: 'idle', to: 'run' }] }), 'utf8');
    let reference;
    try {
      const imported = await postTool('assetBatchImport', { items: [{ sourceFilesystemPath: source, targetAssetPath: 'db://assets/__ccb3x_graph__.json' }] });
      assert.equal(imported.status, 200); reference = imported.body.outcomes[0].reference;
      const inspect = await getJson(`/tools/animationGraphInspect?reference%5Bid%5D=${reference.id}`); assert.equal(inspect.status, 200); assert.equal(inspect.body.nodeCount, 2);
      const valid = await getJson(`/tools/animationGraphValidate?reference%5Bid%5D=${reference.id}`); assert.equal(valid.status, 200); assert.equal(valid.body.valid, true);
      const missing = await getJson('/tools/animationGraphInspect?reference%5Bid%5D=__missing_graph__'); assert.equal(missing.status, 404);
    } finally { if (reference) await postTool('assetBatchOperate', { items: [{ operation: 'delete', reference }] }); fs.rmSync(source, { force: true }); }
  });

  it('creates a native animation graph with stable imported read-back', async (t) => {
    if (!health?.ok) { t.skip(health.reason); return; }
    const preset = await getJson('/tools/assetQuery?pattern=db%3A%2F%2Finternal%2Fdefault_file_content%2Fanimation-graph%2Fdefault.animgraph');
    if (preset.status !== 200 || preset.body.total < 1) {
      t.skip('Creator does not expose the native animation graph preset fixture.');
      return;
    }
    const assetPath = 'db://assets/__ccb3x_native_graph_qualification__';
    let reference;
    try {
      const created = await postTool('animationGraphCreate', { assetPath });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.verified, true);
      assert.equal(typeof created.body.reference.id, 'string');
      assert.match(created.body.assetPath, /__ccb3x_native_graph_qualification__\.animgraph$/);
      reference = created.body.reference;
      const inspected = await getJson(`/tools/animationGraphInspect?reference%5Bid%5D=${encodeURIComponent(reference.id)}`);
      assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
      assert.equal(inspected.body.reference.id, reference.id);
    } finally {
      if (reference) await postTool('assetOperate', { operation: 'delete', reference });
    }
    const missing = await postTool('animationGraphCreate', { assetPath: 'db://assets/../unsafe' });
    assert.equal(missing.status, 400);
  });
});
