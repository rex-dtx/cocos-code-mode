'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSource(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function toolSlice(source, name) {
  const start = source.indexOf(`'${name}'`);
  assert.notEqual(start, -1, `${name} route must exist`);
  const next = source.indexOf('@utcpTool(', start + name.length);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('Wave F material/rendering/terrain/model authoring contracts', () => {
  it('material edit and validation fail closed with authoritative importer/native read-back', () => {
    const source = readSource('source/utcp/tools/material-tools.ts');
    const edit = toolSlice(source, 'materialEdit');
    const validate = toolSlice(source, 'materialValidate');
    assert.match(edit, /query-asset-info/);
    assert.match(edit, /getProperties/);
    assert.match(edit, /READBACK_MISMATCH/);
    assert.match(edit, /ROLLBACK_FAILED/);
    assert.match(validate, /queryMaterial/);
    assert.match(validate, /IMPORTER_INSPECTION_FAILED/);
  });

  it('editor-side rendering routes are bounded and explicitly avoid runtime claims', () => {
    const source = readSource('source/utcp/tools/material-tools.ts');
    const apply = toolSlice(source, 'renderConfigurationApply');
    const diagnostics = toolSlice(source, 'renderDiagnosticsCollect');
    assert.match(apply, /maxItems: 32/);
    assert.match(apply, /set-property/);
    assert.match(apply, /snapshot/);
    assert.match(apply, /ROLLBACK_FAILED/);
    assert.match(diagnostics, /runtimeSampling: false/);
    assert.match(diagnostics, /UNSUPPORTED_EDITOR_API/);
  });

  it('terrain edit is an explicit version-gated typed failure and model workflows expose inspect/validate', () => {
    const source = readSource('source/utcp/tools/portfolio-validation-tools.ts');
    const terrain = toolSlice(source, 'terrainEdit');
    const configure = toolSlice(source, 'modelImportConfigure');
    const inspect = toolSlice(source, 'modelImportInspect');
    const validate = toolSlice(source, 'modelImportValidate');
    assert.match(terrain, /UNSUPPORTED_EDITOR_API/);
    assert.match(terrain, /height|layers/);
    assert.match(configure, /assetImportSettingsSet/);
    assert.match(inspect, /assetImportSettingsGet/);
    assert.match(validate, /OUTPUTS_UNAVAILABLE/);
  });
});
