'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: buildLogInspect candidate witness', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  it('inspects one real terminal build task without fabricating unavailable logs', async (t) => {
    if (!health?.ok) { t.skip(`editor not running: ${health?.reason ?? 'unknown'}`); return; }
    const tasks = await postTool('buildManage', { operation: 'tasks_info', limit: 20 });
    assert.equal(tasks.status, 200, JSON.stringify(tasks.body));
    const terminal = tasks.body.tasks.find((task) => ['success', 'failure', 'failed', 'cancelled', 'canceled'].includes(task.state));
    assert.ok(terminal, 'qualification fixture requires one terminal Creator build task');
    const inspected = await getJson(`/tools/buildLogInspect?taskId=${encodeURIComponent(terminal.id)}&maxEntries=10&maxBytes=8192`);
    assert.equal(inspected.status, 200, JSON.stringify(inspected.body));
    assert.equal(inspected.body.task.id, terminal.id);
    assert.equal(inspected.body.terminal, true);
    assert.ok(Array.isArray(inspected.body.entries));
    assert.equal(inspected.body.count, inspected.body.entries.length);
    if (!inspected.body.available) assert.deepEqual(inspected.body.entries, []);
    const missing = await getJson('/tools/buildLogInspect?taskId=__missing_build_task__');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
  });
});
