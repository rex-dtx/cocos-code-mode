'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

describe('live: portable parity tools', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  function skip(t, tool) {
    if (!health || !health.ok) { t.skip(`editor not running: ${health ? health.reason : 'no health'}`); return true; }
    return false;
  }

  it('missing nodeCreate name returns 400 MISSING_INPUTS', async (t) => {
    if (skip(t)) return;
    const r = await postTool('nodeCreate', {});
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'MISSING_INPUTS');
    assert.ok(Array.isArray(r.body.details && r.body.details.missingInputs));
    assert.ok(r.body.details.missingInputs.includes('name'));
  });

  it('findNodes requires a filter', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/findNodes');
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'MISSING_INPUTS');
  });

  it('findNodes matches Canvas', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/findNodes?name=Canvas');
    assert.equal(r.ok, true);
    assert.ok(r.body.total >= 1);
    assert.ok(r.body.nodes.some((n) => n.name === 'Canvas'));
  });

  it('getEditorPreference lists known keys', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/getEditorPreference');
    assert.equal(r.ok, true);
    assert.ok(r.body.all && Object.prototype.hasOwnProperty.call(r.body.all, 'serverPort'));
  });

  it('projectFileExists sees settings/project.json', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/projectFileExists?filePath=settings/project.json');
    assert.equal(r.ok, true);
    assert.equal(r.body.exists, true);
    assert.equal(r.body.isDirectory, false);
  });

  it('runtimeGetState returns paused/timeScale/frameCount', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/runtimeGetState');
    assert.equal(r.ok, true);
    assert.equal(typeof r.body.paused, 'boolean');
    assert.equal(typeof r.body.timeScale, 'number');
    assert.equal(typeof r.body.frameCount, 'number');
  });

  it('getPerformanceSnapshot counts nodes', async (t) => {
    if (skip(t)) return;
    const r = await getJson('/tools/getPerformanceSnapshot');
    assert.equal(r.ok, true);
    assert.ok(r.body.nodeCount > 0);
    assert.ok(r.body.componentCount > 0);
  });

  it('createLabel then nodeRemove roundtrip', async (t) => {
    if (skip(t)) return;
    const created = await postTool('createLabel', { name: '__parity_label__', text: 'parity' });
    assert.equal(created.ok, true, JSON.stringify(created.body));
    assert.ok(created.body.uuid);
    const removed = await postTool('nodeRemove', { uuid: created.body.uuid });
    assert.equal(removed.ok, true);
    assert.equal(removed.body.removed, created.body.uuid);
  });
});
