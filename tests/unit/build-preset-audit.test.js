'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

const { buildBuildPresetAudit } = requireDist('build-preset-audit.js');

describe('buildPresetAudit pure validator', () => {
  it('normalizes a known web target and accepts public shared and target options', () => {
    const result = buildBuildPresetAudit(' WEB-MOBILE ', {
      buildPath: 'build/web-mobile',
      sourceMaps: 'inline',
      debug: true,
      orientation: 'landscape',
      embedWebDebugger: true,
    });
    assert.equal(result.platform, 'web-mobile');
    assert.equal(result.valid, true);
    assert.equal(result.complete, true);
    assert.deepEqual(result.supportedOptions, ['buildPath', 'sourceMaps', 'debug', 'orientation', 'embedWebDebugger']);
    assert.deepEqual(result.unknownOptions, []);
    assert.deepEqual(result.warnings, []);
  });

  it('reports target-unsupported and unknown options without accepting either', () => {
    const options = {
      buildPath: 'build/android',
      packageName: 'com.example.game',
      useWebGPU: true,
      madeUpOption: false,
    };
    const before = structuredClone(options);
    const result = buildBuildPresetAudit('android', options);
    assert.equal(result.valid, false);
    assert.equal(result.complete, true);
    assert.deepEqual(result.unsupportedOptions, ['useWebGPU']);
    assert.deepEqual(result.unknownOptions, ['madeUpOption']);
    assert.deepEqual(result.errors.map((issue) => issue.code), ['UNSUPPORTED_OPTION', 'UNKNOWN_OPTION']);
    assert.deepEqual(options, before);
  });

  it('enforces target-specific option types and finite enum values', () => {
    const result = buildBuildPresetAudit('ios', {
      buildPath: 'build/ios',
      packageName: 'com.example.game',
      renderBackEnd: 'metal',
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.some((issue) => issue.code === 'INVALID_OPTION' && issue.path === 'options.renderBackEnd'), true);
    const windows = buildBuildPresetAudit('windows', { targetPlatform: 'win32' });
    assert.equal(windows.valid, false);
    assert.equal(windows.errors[0].path, 'options.targetPlatform');
  });

  it('is bounded and rejects unknown platforms or non-object options', () => {
    const unknown = buildBuildPresetAudit('console', {});
    assert.equal(unknown.complete, false);
    assert.equal(unknown.errors[0].code, 'UNKNOWN_PLATFORM');
    const malformed = buildBuildPresetAudit('mac', null);
    assert.equal(malformed.complete, false);
    assert.equal(malformed.errors[0].code, 'INVALID_OPTIONS');
    const longKey = buildBuildPresetAudit('mac', { ['x'.repeat(500)]: 'x'.repeat(1000), toString: false });
    assert.equal(longKey.unknownOptions[0].length, 128);
    assert.equal(longKey.unknownOptions[1], 'toString');
    assert.equal(longKey.errors.every((issue) => String(issue.path).length <= 141), true);
    assert.equal(longKey.errors.every((issue) => JSON.stringify(issue).length < 600), true);
  });

  it('registers a distinct read-only POST tool without build dispatch or IPC', () => {
    const source = readSource('utcp/tools/build-tools.ts');
    const start = source.indexOf("'buildPresetAudit'");
    const end = source.indexOf('async buildPresetAudit', start);
    const slice = source.slice(start, end);
    assert.ok(start >= 0);
    assert.match(slice, /'POST'/);
    assert.match(slice, /maxProperties: 64/);
    assert.match(slice, /supportedOptions/);
    assert.doesNotMatch(slice, /Editor\.Message\.request|add-task|query-task/);
  });
});
