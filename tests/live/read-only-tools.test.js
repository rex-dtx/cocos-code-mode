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

  it('projectFileExists reports known files and rejects project traversal', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/projectFileExists?filePath=package.json');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { exists: true, isDirectory: false });

    const invalid = await getJson('/tools/projectFileExists?filePath=../package.json');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_ARGUMENT');
  });

  it('readProjectInstruction distinguishes an existing instruction from a missing file', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/readProjectInstruction?filePath=README.md');
    assert.equal(result.status, 200);
    assert.equal(result.body.exists, true);
    assert.equal(result.body.filePath, 'README.md');
    assert.ok(result.body.content.includes('CC30 New Slot Base'));

    const missing = await getJson('/tools/readProjectInstruction?filePath=.missing-qualification-file');
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, {
      content: '',
      exists: false,
      filePath: '.missing-qualification-file',
      bytes: 0,
    });
  });
  it('getEditorPreference reads the live server port and rejects a non-string key', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/getEditorPreference?key=serverPort');
    assert.equal(result.status, 200);
    assert.equal(result.body.key, 'serverPort');
    assert.equal(result.body.value, 49650);

    const invalid = await getJson('/tools/getEditorPreference?key%5B%5D=serverPort');
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.validationErrors.some((error) => error.path === 'key' && error.keyword === 'type'));
  });

  it('editorGetLogs returns a bounded log window and rejects zero count', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/editorGetLogs?count=3');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.logLines));
    assert.ok(result.body.logLines.length <= 3);
    assert.equal(typeof result.body.total, 'number');
    assert.equal(typeof result.body.truncated, 'boolean');

    const invalid = await getJson('/tools/editorGetLogs?count=0');
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.validationErrors.some((error) => error.path === 'count' && error.keyword === 'minimum'));
  });

  it('listEditorWindows returns typed live window records', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/listEditorWindows');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.windows));
    assert.ok(result.body.windows.some((window) => Number.isInteger(window.id) && typeof window.title === 'string'));
  });
});
