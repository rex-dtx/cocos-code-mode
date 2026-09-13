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
  it('proves physics query and shader validation positive/negative paths', async (t) => {
    if (!health?.ok) { t.skip(health.reason); return; }
    for (const name of ['physics2dQuery', 'physics3dQuery']) { const r = await getJson(`/tools/${name}`); assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.nodes)); }
    const valid = await getJson('/tools/shaderValidate?effectName=builtin-standard'); assert.equal(valid.status, 200); assert.equal(valid.body.valid, true);
    const invalid = await getJson('/tools/shaderValidate?effectName=__missing_effect__'); assert.equal(invalid.status, 200); assert.equal(invalid.body.valid, false); assert.equal(invalid.body.diagnostics[0].code, 'EFFECT_NOT_FOUND');
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
});
