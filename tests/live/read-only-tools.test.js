'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { getJson, postTool, healthCheck } = require('../helpers/utcp-client');

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

  it('Creator 3.7 project file and instruction mutation round-trip', async (t) => {
    if (skipIfDown(t)) return;
    const assetPath = 'assets/__ccb3x_project_write_qualification__.txt';
    const instructionPath = '__ccb3x_instruction_qualification__.md';
    let assetReference;
    try {
      const written = await postTool('projectWriteFile', {
        filePath: assetPath,
        content: 'ccb3x-marker-A\nccb3x-marker-A\n',
      });
      assert.equal(written.status, 200, JSON.stringify(written.body));
      assert.equal(written.body.success, true);
      assert.equal(written.body.bytesWritten, Buffer.byteLength('ccb3x-marker-A\nccb3x-marker-A\n'));

      const replaced = await postTool('projectReplaceInFile', {
        filePath: assetPath,
        search: 'ccb3x-marker-A',
        replace: 'ccb3x-marker-B',
      });
      assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
      assert.deepEqual(replaced.body, { success: true, replacements: 2 });

      const read = await getJson(`/tools/projectReadFile?filePath=${encodeURIComponent(assetPath)}`);
      assert.equal(read.status, 200);
      assert.equal(read.body.content, 'ccb3x-marker-B\nccb3x-marker-B\n');

      const instruction = await postTool('writeProjectInstruction', {
        filePath: instructionPath,
        content: '# ccb3x qualification\n',
      });
      assert.equal(instruction.status, 200, JSON.stringify(instruction.body));
      assert.equal(instruction.body.success, true);
      const readInstruction = await getJson(`/tools/readProjectInstruction?filePath=${encodeURIComponent(instructionPath)}`);
      assert.equal(readInstruction.status, 200);
      assert.equal(readInstruction.body.content, '# ccb3x qualification\n');

      const asset = await getJson(`/tools/assetGetAtPath?assetPath=${encodeURIComponent(`db://${assetPath}`)}`);
      assert.equal(asset.status, 200, JSON.stringify(asset.body));
      assetReference = asset.body.reference;
      assert.equal(typeof assetReference?.id, 'string');
    } finally {
      if (assetReference?.id) {
        await postTool('assetOperate', { operation: 'delete', reference: assetReference });
      }
      await postTool('projectWriteFile', { filePath: instructionPath, content: '' });
    }

    const invalidWrite = await postTool('projectWriteFile', { filePath: '../outside.txt', content: 'x' });
    assert.equal(invalidWrite.status, 400);
    const invalidReplace = await postTool('projectReplaceInFile', {
      filePath: 'missing-qualification-file.txt',
      search: 'x',
      replace: 'y',
    });
    assert.equal(invalidReplace.status, 500);
    const invalidInstruction = await postTool('writeProjectInstruction', {
      filePath: '../outside.md',
      content: 'x',
    });
    assert.equal(invalidInstruction.status, 400);
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

  it('assetGetAtPath resolves assets and types missing paths', async (t) => {
    if (skipIfDown(t)) return;
    const assets = await getJson('/tools/assetQuery?importer=image&limit=1');
    assert.equal(assets.status, 200);
    const asset = assets.body.assets?.[0];
    assert.equal(typeof asset?.url, 'string');

    const result = await getJson(`/tools/assetGetAtPath?assetPath=${encodeURIComponent(asset.url)}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.reference.id, asset.uuid);

    const missing = await getJson('/tools/assetGetAtPath?assetPath=db%3A%2F%2Fassets%2F__missing__%2Fnone.png');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'TARGET_NOT_FOUND');
  });

  it('asset and material reverse reads return bounded typed results', async (t) => {
    if (skipIfDown(t)) return;
    const materialAssets = await getJson('/tools/assetQuery?importer=material&limit=1');
    assert.equal(materialAssets.status, 200);
    const material = materialAssets.body.assets?.[0];
    assert.equal(typeof material?.uuid, 'string');

    const effects = await getJson('/tools/materialQuery?operation=effects&limit=5');
    assert.equal(effects.status, 200);
    assert.ok(Array.isArray(effects.body.result));
    assert.equal(typeof effects.body.total, 'number');
    assert.equal(typeof effects.body.truncated, 'boolean');

    const materialInfo = await getJson(`/tools/materialQuery?operation=material&reference%5Bid%5D=${encodeURIComponent(material.uuid)}`);
    assert.equal(materialInfo.status, 200);
    assert.ok(materialInfo.body.result && typeof materialInfo.body.result === 'object');

    const nodesByAsset = await getJson(`/tools/findNodesByAsset?reference%5Bid%5D=${encodeURIComponent(material.uuid)}&limit=5`);
    assert.equal(nodesByAsset.status, 200);
    assert.deepEqual(Object.keys(nodesByAsset.body).sort(), ['references', 'total', 'truncated'].sort());
    assert.ok(Array.isArray(nodesByAsset.body.references));

    const missingNodes = await getJson('/tools/findNodesWithMissingAssets?limit=5');
    assert.equal(missingNodes.status, 200);
    assert.deepEqual(Object.keys(missingNodes.body).sort(), ['references', 'total', 'truncated'].sort());
    assert.ok(Array.isArray(missingNodes.body.references));

    const invalid = await getJson('/tools/findNodesByAsset');
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.body.missingInputs, ['reference']);
  });

  it('batch read APIs preserve ordering, bounds, and validation', async (t) => {
    if (skipIfDown(t)) return;
    const sceneBatch = await getJson('/tools/sceneBatchGet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { target: 'CurrentSceneGlobals', fields: ['ambient'] },
          { target: 'ProjectSettings', fields: ['general'] },
        ],
      }),
    });
    assert.equal(sceneBatch.status, 200);
    assert.equal(sceneBatch.body.results.length, 2);
    assert.equal(sceneBatch.body.results[0].reference.id, 'CurrentSceneGlobals');
    assert.equal(sceneBatch.body.results[1].reference.id, 'ProjectSettings');

    const assetBatch = await getJson('/tools/assetBatchQuery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: [{ importer: 'material', limit: 1 }, { ccType: 'cc.ImageAsset', limit: 1 }] }),
    });
    assert.equal(assetBatch.status, 200);
    assert.equal(assetBatch.body.results.length, 2);
    assert.ok(assetBatch.body.results.every(result => Array.isArray(result.assets) && result.assets.length <= 1));

    const emptySceneBatch = await getJson('/tools/sceneBatchGet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [] }),
    });
    assert.equal(emptySceneBatch.status, 400);

    const unfilteredAssetBatch = await getJson('/tools/assetBatchQuery', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: [{}] }),
    });
    assert.equal(unfilteredAssetBatch.status, 400);
  });

  it('Creator 3.7 screenshots return validated JPEG and PNG payloads', async (t) => {
    if (skipIfDown(t)) return;
    const scene = await getJson('/tools/captureSceneScreenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageSize: 64, jpegQuality: 70 }),
    });
    assert.equal(scene.status, 200);
    assert.equal(scene.body.mimeType, 'image/jpeg');
    assert.ok(scene.body.data.startsWith('/9j/'));

    const editor = await getJson('/tools/captureEditorScreenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(editor.status, 200);
    assert.equal(editor.body.mimeType, 'image/png');
    assert.ok(editor.body.data.startsWith('iVBOR'));

    const invalid = await getJson('/tools/captureSceneScreenshot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageSize: 0 }),
    });
    assert.equal(invalid.status, 400);
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

    const unsupported = await getJson('/tools/editorQuery?category=sorted_plugins');
    assert.equal(unsupported.status, 422);
    assert.equal(unsupported.body.code, 'UNSUPPORTED_EDITOR_API');
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

    const unsupported = await getJson('/tools/assetDbQuery?operation=missing&reference%5Bid%5D=__unknown_asset_uuid__');
    assert.equal(unsupported.status, 422);
    assert.equal(unsupported.body.code, 'UNSUPPORTED_EDITOR_API');
  });

  it('Creator 3.7 runtime and editor control APIs return observable outcomes', async (t) => {
    if (skipIfDown(t)) return;
    const state = await getJson('/tools/runtimeGetState');
    assert.equal(state.status, 200);
    assert.equal(typeof state.body.timeScale, 'number');

    const slowed = await getJson('/tools/runtimeSetTimeScale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scale: 0.5 }),
    });
    assert.equal(slowed.status, 200);
    assert.equal(slowed.body.success, true);
    assert.equal(slowed.body.scale, 0.5);
    const restored = await getJson('/tools/runtimeSetTimeScale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scale: 1 }),
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.scale, 1);

    const found = await getJson('/tools/findNodes?name=Canvas&maxResults=1');
    assert.equal(found.status, 200);
    const reference = found.body.nodes?.[0]?.reference;
    assert.equal(typeof reference?.id, 'string');

    const selected = await getJson('/tools/editorSelect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'select', references: [reference] }),
    });
    assert.equal(selected.status, 200);
    assert.ok(selected.body.selected.includes(reference.id));

    const queried = await getJson('/tools/editorSelect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'query' }),
    });
    assert.equal(queried.status, 200);
    assert.ok(queried.body.selected.includes(reference.id));

    const batchSet = await getJson('/tools/nodeBatchSet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [{ reference, propertyPaths: ['active'], values: [true] }] }),
    });
    assert.equal(batchSet.status, 200);
    assert.equal(batchSet.body.success, true);

    const cleared = await getJson('/tools/editorSelect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'clear' }),
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.selected ?? [], []);

    const history = await getJson('/tools/editorHistory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'abort' }),
    });
    assert.equal(history.status, 200);
    assert.equal(history.body.success, true);
  });

  it('Creator 3.7 viewport query and toggles round-trip', async (t) => {
    if (skipIfDown(t)) return;
    const before = await getJson('/tools/editorViewport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'query_viewport' }),
    });
    assert.equal(before.status, 200);
    assert.equal(typeof before.body.is2D, 'boolean');
    assert.equal(typeof before.body.gridVisible, 'boolean');

    const toggled = await getJson('/tools/editorViewport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'set_grid_visible', enabled: !before.body.gridVisible }),
    });
    assert.equal(toggled.status, 200);
    assert.equal(toggled.body.success, true);

    const after = await getJson('/tools/editorViewport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'query_viewport' }),
    });
    assert.equal(after.status, 200);
    assert.equal(after.body.gridVisible, !before.body.gridVisible);

    const restored = await getJson('/tools/editorViewport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'set_grid_visible', enabled: before.body.gridVisible }),
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.success, true);

    const gizmo = await getJson('/tools/editorViewport', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'query_gizmo' }),
    });
    assert.equal(gizmo.status, 200);
    assert.equal(typeof gizmo.body.gizmoTool, 'string');
    assert.equal(typeof gizmo.body.gizmoPivot, 'string');
    assert.equal(typeof gizmo.body.gizmoCoordinate, 'string');
  });

  it('Creator 3.7 project and build managers expose bounded read state', async (t) => {
    if (skipIfDown(t)) return;
    const project = await getJson('/tools/projectManage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'get', limit: 20 }),
    });
    assert.equal(project.status, 200);
    assert.ok(project.body.config && typeof project.body.config === 'object');
    assert.equal(typeof project.body.total, 'number');
    assert.equal(typeof project.body.truncated, 'boolean');
    assert.equal(project.body.truncated, false);

    const tasks = await getJson('/tools/buildManage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'tasks_info', limit: 5 }),
    });
    assert.equal(tasks.status, 200);
    assert.equal(typeof tasks.body.workerReady, 'boolean');
    assert.equal(typeof tasks.body.free, 'boolean');
    assert.equal(typeof tasks.body.total, 'number');
    assert.equal(typeof tasks.body.truncated, 'boolean');

    const invalid = await getJson('/tools/projectManage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'set' }),
    });
    assert.equal(invalid.status, 400);
  });

  it('scene read queries preserve empty results and type missing nodes', async (t) => {
    if (skipIfDown(t)) return;
    const tree = await getJson('/tools/nodeGetTree?maxDepth=1&maxNodes=50');
    assert.equal(tree.status, 200);
    const canvas = tree.body.children.find((node) => node.name === 'Canvas');
    assert.ok(canvas?.reference?.id, 'Canvas reference');

    const pathHit = await getJson('/tools/nodeGetAtPath?hierarchyPath=%2FCanvas');
    assert.equal(pathHit.status, 200);
    assert.equal(pathHit.body.references[0].id, canvas.reference.id);

    const pathMiss = await getJson('/tools/nodeGetAtPath?hierarchyPath=%2F__missing__');
    assert.equal(pathMiss.status, 200);
    assert.deepEqual(pathMiss.body.references, []);

    const methods = await getJson(`/tools/listComponentMethods?reference%5Bid%5D=${encodeURIComponent(canvas.reference.id)}`);
    assert.equal(methods.status, 200);
    assert.ok(Array.isArray(methods.body.components));

    const missingMethods = await getJson('/tools/listComponentMethods?reference%5Bid%5D=__missing_node_uuid__');
    assert.equal(missingMethods.status, 404);
    assert.equal(missingMethods.body.code, 'TARGET_NOT_FOUND');

    const animationState = await getJson('/tools/animationQuery?operation=state');
    assert.equal(animationState.status, 200);
    assert.ok(Object.prototype.hasOwnProperty.call(animationState.body, 'result'));
    assert.equal(animationState.body.result, null);
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
