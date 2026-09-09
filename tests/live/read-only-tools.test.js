'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, healthCheck } = require('../helpers/utcp-client');

describe('live: read-only endpoint qualification', () => {
  let health;
  before(async () => { health = await healthCheck(); });

  function skipIfDown(t) {
    if (health?.ok) return false;
    t.skip(`editor not running: ${health?.reason ?? 'unknown'}`);
    return true;
  }

  it('editorEnvInfo reports the declared CC373 environment', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/editorEnvInfo');
    assert.equal(result.status, 200);
    assert.equal(result.body.editor, '3.7.3');
    assert.equal(result.body.engineVersion, '3.7.3');
    assert.equal(typeof result.body.projectPath, 'string');
  });

  it('nodeGetAvailableComponentTypes returns a bounded list and rejects zero limit', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/nodeGetAvailableComponentTypes?limit=5');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.componentTypes));
    assert.ok(result.body.componentTypes.length <= 5);
    assert.equal(typeof result.body.total, 'number');

    const invalid = await getJson('/tools/nodeGetAvailableComponentTypes?limit=0');
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.validationErrors.some((error) => error.path === 'limit' && error.keyword === 'minimum'));
  });

  it('projectSearchFiles finds a known project file and rejects a missing pattern', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/projectSearchFiles?pattern=package.json&limit=5');
    assert.equal(result.status, 200);
    assert.ok(result.body.files.includes('package.json'));
    assert.equal(result.body.total, 1);

    const invalid = await getJson('/tools/projectSearchFiles');
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body.missingInputs, ['pattern']);
  });

  it('projectReadFile rejects paths outside the project as invalid input', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/projectReadFile?filePath=../package.json');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });

  it('projectListDirectory rejects paths outside the project as invalid input', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/projectListDirectory?dirPath=..');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });

  it('listComponentClasses defaults to component classes and applies its filter', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/listComponentClasses?filter=Label');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.classes));
    assert.ok(result.body.classes.length > 0);
    assert.ok(result.body.classes.every((name) => name.toLowerCase().includes('label')));
  });

  it('listEditorWindows returns typed live window records', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/listEditorWindows');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.windows));
    assert.ok(result.body.windows.some((window) => Number.isInteger(window.id) && typeof window.title === 'string'));
  });
});
