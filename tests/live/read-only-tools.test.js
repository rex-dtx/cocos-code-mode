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

  it('assetGetAvailableUrl returns a non-colliding database URL', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/assetGetAvailableUrl?assetPath=db%3A%2F%2Fassets%2F__qualification_probe__.txt');
    assert.equal(result.status, 200);
    assert.match(result.body.url, /^db:\/\/assets\/__qualification_probe__\.txt/);

    const invalid = await getJson('/tools/assetGetAvailableUrl');
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body.missingInputs, ['assetPath']);
  });

  it('assetFindReferences returns typed dependency references for an image asset', async (t) => {
    if (skipIfDown(t)) return;
    const assets = await getJson('/tools/assetQuery?importer=image&limit=1');
    assert.equal(assets.status, 200);
    const id = assets.body.assets?.[0]?.uuid;
    assert.equal(typeof id, 'string');

    const result = await getJson(`/tools/assetFindReferences?reference%5Bid%5D=${encodeURIComponent(id)}&limit=5`);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.references));
    assert.ok(result.body.references.length > 0);
    assert.equal(typeof result.body.total, 'number');
    assert.equal(typeof result.body.truncated, 'boolean');

    const invalid = await getJson('/tools/assetFindReferences');
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body.missingInputs, ['reference']);
    const empty = await getJson('/tools/assetFindReferences?reference%5Bid%5D=__unknown_asset_uuid__&limit=5');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.references, []);
    assert.equal(empty.body.total, 0);
    assert.equal(empty.body.truncated, false);
  });

  it('runtimeGetState returns typed runtime state', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/runtimeGetState');
    assert.equal(result.status, 200);
    assert.equal(typeof result.body.paused, 'boolean');
    assert.equal(typeof result.body.timeScale, 'number');
    assert.equal(typeof result.body.frameCount, 'number');
  });

  it('getPerformanceSnapshot returns internally consistent counters', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/getPerformanceSnapshot');
    assert.equal(result.status, 200);
    assert.ok(Number.isInteger(result.body.nodeCount));
    assert.ok(Number.isInteger(result.body.componentCount));
    assert.ok(Number.isInteger(result.body.uiNodeCount));
    assert.ok(Number.isInteger(result.body.maxDepth));
    assert.ok(Number.isInteger(result.body.activeNodes));
    assert.ok(result.body.activeNodes <= result.body.nodeCount);
    assert.ok(Array.isArray(result.body.warnings));
  });

  it('sceneSnapshot enforces bounded tree output and truncation markers', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/sceneSnapshot?maxNodes=1&maxDepth=0');
    assert.equal(result.status, 200);
    assert.equal(result.body.nodeCount, 1);
    assert.ok(result.body.tree);
    assert.ok(result.body.truncated);

    const invalid = await getJson('/tools/sceneSnapshot?maxNodes=0');
    assert.equal(invalid.status, 400);
    assert.ok(invalid.body.validationErrors.some((error) => error.path === 'maxNodes' && error.keyword === 'minimum'));
  });

  it('editorQuery exposes stable editor vocabulary categories', async (t) => {
    if (skipIfDown(t)) return;
    const ready = await getJson('/tools/editorQuery?category=ready');
    assert.equal(ready.status, 200);
    assert.equal(typeof ready.body.ready, 'boolean');

    const layers = await getJson('/tools/editorQuery?category=layers');
    assert.equal(layers.status, 200);
    assert.ok(Array.isArray(layers.body.values));
    assert.ok(layers.body.values.length > 0);

    const assetTypes = await getJson('/tools/editorQuery?category=asset_types');
    assert.equal(assetTypes.status, 200);
    assert.ok(Array.isArray(assetTypes.body.types));
    assert.ok(assetTypes.body.types.length > 0);
  });

  it('assetDbQuery returns typed database readiness state', async (t) => {
    if (skipIfDown(t)) return;
    const databases = await getJson('/tools/assetDbQuery?operation=databases');
    assert.equal(databases.status, 200);
    assert.ok(Array.isArray(databases.body.result));
    assert.ok(databases.body.result.includes('assets'));

    const ready = await getJson('/tools/assetDbQuery?operation=ready');
    assert.equal(ready.status, 200);
    assert.equal(typeof ready.body.result, 'boolean');
  });

  it('assetReadContent reads text assets and rejects binary assets with typed errors', async (t) => {
    if (skipIfDown(t)) return;
    const text = await getJson('/tools/assetReadContent?assetPath=db%3A%2F%2Fassets%2Fcc-common%2Fcc-network%2Fgame-network.js&verbose=true');
    assert.equal(text.status, 200);
    assert.equal(typeof text.body.content, 'string');
    assert.equal(text.body.truncated, false);

    const binary = await getJson('/tools/assetReadContent?assetPath=db%3A%2F%2Finternal%2FDefault-Particle.png');
    assert.equal(binary.status, 422);
    assert.equal(binary.body.code, 'ASSET_BINARY_UNREADABLE');
  });

  it('readProjectInstruction rejects traversal with typed invalid-argument error', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/readProjectInstruction?filePath=../package.json');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_ARGUMENT');
  });

  it('readPrefabJson reports missing prefab targets as typed not-found errors', async (t) => {
    if (skipIfDown(t)) return;
    const result = await getJson('/tools/readPrefabJson?assetPath=db%3A%2F%2Fassets%2F__missing-qualification__.prefab');
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'TARGET_NOT_FOUND');
  });
});
