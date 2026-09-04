'use strict';
// Lane C — contract tests for the 3 intake ops: materialQuery, assetDbQuery, editorQuery:has_script.
// Verifies (a) IPC existence (registry + facade), (b) strict schemas (oneOf/allOf + required),
// (c) GET classification + Editor.Message.request transport, (d) error paths for missing required inputs.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSource(rel) {
  return fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
}

function toolSlice(source, toolName) {
  const start = source.indexOf(`'${toolName}'`);
  assert.notEqual(start, -1, `${toolName} decorator must exist`);
  const next = source.indexOf('@utcpTool(', start + toolName.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('Lane C intake — IPC verification', () => {
  it('materialQuery IPC messages exist in registry and facade', () => {
    const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/cc-3x7-message-registry.json'), 'utf8'));
    const facade = fs.readFileSync(
      path.resolve(__dirname, '../../node_modules/@cocos/creator-types/editor/packages/scene/@types/cce/3d/facade/general-scene-facade.d.ts'),
      'utf8',
    );
    const sceneMap = {
      'query-all-effects': 'queryAllEffects',
      'query-effect': 'queryEffect',
      'query-material': 'queryMaterial',
      'query-serialized-material': null, // runtime-only, no facade
      'query-render-pipeline': 'queryRenderPipeline',
      'query-physics-material': 'queryPhysicsMaterial',
    };
    for (const [msg, facadeFn] of Object.entries(sceneMap)) {
      assert.ok(registry.scene?.[msg], `scene/${msg} must exist in 3.7.3 registry`);
      if (facadeFn) assert.ok(facade.includes(facadeFn), `facade must type ${facadeFn} (scene/${msg})`);
    }
    assert.ok(facade.includes('queryComponentHasScript'), 'facade must type queryComponentHasScript (has_script)');
    assert.ok(registry.scene?.['query-component-has-script'], 'scene/query-component-has-script must exist (typed public)');
  });

  it('assetDbQuery IPC messages exist in registry (with post-3.7.3 caveat for missing)', () => {
    const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../docs/cc-3x7-message-registry.json'), 'utf8'));
    for (const msg of ['query-db-list', 'is-busy', 'query-asset-mtime', 'query-asset-data', 'query-db-info', 'query-asset-meta', 'query-ready']) {
      assert.ok(registry['asset-db']?.[msg], `asset-db/${msg} must exist in 3.7.3 registry`);
    }
    // query-missing-asset-info is typed in 3.8.7 creator-types but absent from 3.7.3 registry dump — tool must guard via isMessageNotExposed.
    const materials = readSource('source/utcp/tools/material-tools.ts');
    assert.match(materials, /query-missing-asset-info/);
    assert.match(materials, /isMessageNotExposed\(e, 'asset-db', 'query-missing-asset-info'\)/);
  });
});

describe('Lane C intake — strict schemas + GET/read classification', () => {
  it('materialQuery is GET with oneOf strict requirements per operation', () => {
    const src = readSource('source/utcp/tools/material-tools.ts');
    const slice = toolSlice(src, 'materialQuery');
    assert.match(slice, /"GET"/);
    assert.match(slice, /oneOf:/);
    assert.match(slice, /required: \['effectName'\]/);
    assert.match(slice, /required: \['reference'\]/);
    assert.match(slice, /maximum: MAX_EFFECT_RESULTS/);
    assert.match(slice, /boundedPositive\(args\.limit, DEFAULT_EFFECT_RESULTS, MAX_EFFECT_RESULTS\)/);
    // transport must be Editor.Message.request only
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-all-effects'/);
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-effect'/);
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-material'/);
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-serialized-material'/);
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-render-pipeline'/);
    assert.match(slice, /Editor\.Message\.request\('scene', 'query-physics-material'/);
    // error paths
    assert.match(slice, /materialQuery "effect" requires effectName/);
    assert.match(slice, /materialQuery "material" requires reference/);
    assert.match(slice, /Unknown materialQuery operation/);
  });

  it('assetDbQuery is GET with oneOf + capped data + typed error for missing', () => {
    const src = readSource('source/utcp/tools/material-tools.ts');
    const slice = toolSlice(src, 'assetDbQuery');
    assert.match(slice, /"GET"/);
    assert.match(slice, /oneOf:/);
    assert.match(slice, /maximum: MAX_RAW_DATA_BYTES/);
    assert.match(slice, /boundedPositive\(args\.maxBytes, DEFAULT_RAW_DATA_BYTES, MAX_RAW_DATA_BYTES\)/);
    assert.match(slice, /truncated: \{ type: 'boolean' \}/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-db-list'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'is-busy'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-asset-mtime'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-asset-data'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-db-info'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-asset-meta'/);
    assert.match(slice, /Editor\.Message\.request\('asset-db', 'query-ready'/);
    assert.match(slice, /assetDbQuery "mtime" requires reference/);
    assert.match(slice, /assetDbQuery "data" requires reference/);
    assert.match(slice, /Unknown assetDbQuery operation/);
  });

  it('editorQuery:has_script is GET with allOf conditional requiring className', () => {
    const src = readSource('source/utcp/tools/consolidated-tools.ts');
    const slice = toolSlice(src, 'editorQuery');
    assert.match(slice, /['"]GET['"]/);
    assert.match(slice, /has_script/);
    assert.match(slice, /category: \{ const: 'has_script' \}.*required: \['className'\]/s);
    // delegation path must exist and carry has_script
    assert.match(src, /has_script/);
    const editorSrc = readSource('source/utcp/tools/editor-tools.ts');
    assert.match(editorSrc, /case 'has_script':/);
    assert.match(editorSrc, /editorIntrospect category "has_script" requires className/);
    assert.match(editorSrc, /Editor\.Message\.request\('scene', 'query-component-has-script'/);
  });

  it('has_script does not invent transport — only Editor.Message.request', () => {
    const editorSrc = readSource('source/utcp/tools/editor-tools.ts');
    const consSrc = readSource('source/utcp/tools/consolidated-tools.ts');
    // has_script path must not use tool.annotations or /utcp special-casing
    assert.doesNotMatch(editorSrc, /tool\.annotations/);
    assert.doesNotMatch(consSrc, /tool\.annotations/);
  });
});
