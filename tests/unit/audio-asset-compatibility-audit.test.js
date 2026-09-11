'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

const { ExpansionTools } = requireDist('utcp/tools/expansion-tools.js');

function createAssetRequest(infos) {
  const calls = [];
  const request = async (service, message, id) => {
    calls.push({ service, message, id });
    assert.equal(service, 'asset-db');
    assert.equal(message, 'query-asset-info');
    return infos[id] ?? null;
  };
  return { request, calls };
}
const { buildAudioAssetCompatibilityAudit } = requireDist('audio-asset-compatibility-audit.js');

const ref = (id) => ({ id, type: 'cc.AudioClip' });

describe('audioAssetCompatibilityAudit', () => {
  it('normalizes public asset identity and accepts documented Creator audio formats', () => {
    const result = buildAudioAssetCompatibilityAudit('web-mobile', [{
      reference: ref('music'),
      info: {
        uuid: 'music', type: 'cc.AudioClip', url: 'db://assets/audio/MUSIC.MP3?cache=1',
        path: 'audio/MUSIC.MP3', importer: ' audio ', importerSettings: { audioLoadMode: 'WEB_AUDIO' },
      },
    }]);
    assert.equal(result.valid, true);
    assert.equal(result.complete, true);
    assert.deepEqual(result.items[0], {
      reference: ref('music'), target: 'web-mobile', valid: true,
      url: 'db://assets/audio/MUSIC.MP3', path: 'audio/MUSIC.MP3', extension: '.mp3',
      importer: 'audio', loadMode: 'web-audio', issues: [],
    });
    assert.deepEqual(result.issues, []);
  });

  it('reports missing assets, type mismatches, unsupported formats, and unknown metadata with typed findings', () => {
    const result = buildAudioAssetCompatibilityAudit('native-desktop', [
      { reference: ref('missing'), info: null },
      { reference: ref('image'), info: { uuid: 'image', type: 'cc.Texture2D', url: 'db://assets/image.png', importer: 'texture' } },
      { reference: ref('codec'), info: { uuid: 'codec', type: 'cc.AudioClip', url: 'db://assets/audio/voice.flac', importer: 'audio' } },
      { reference: ref('opaque'), info: { uuid: 'opaque', type: 'cc.AudioClip', importer: 'audio' } },
    ]);
    assert.equal(result.valid, false);
    assert.equal(result.complete, true);
    assert.deepEqual(result.issues.map((item) => item.code), [
      'ASSET_NOT_FOUND', 'TYPE_MISMATCH', 'UNSUPPORTED_FORMAT', 'UNKNOWN_METADATA',
    ]);
    assert.equal(result.items[1].issues[0].field, 'type');
    assert.equal(result.items[2].issues[0].value, '.flac');
    assert.equal(result.items[3].issues[0].field, 'extension');
  });

  it('rejects failed imports and applies target-specific format rules', () => {
    const failed = buildAudioAssetCompatibilityAudit('native-mobile', [{
      reference: ref('failed'), info: { type: 'cc.AudioClip', url: 'db://assets/failed.ogg', importer: 'audio', imported: false, invalid: true },
    }]);
    assert.equal(failed.valid, false);
    assert.equal(failed.issues[0].code, 'IMPORT_FAILED');
    const mobile = buildAudioAssetCompatibilityAudit('web-mobile', [{
      reference: ref('movie-audio'), info: { type: 'cc.AudioClip', url: 'db://assets/movie.m4a', importer: 'audio', imported: true, invalid: false },
    }]);
    assert.equal(mobile.valid, false);
    assert.equal(mobile.issues[0].code, 'TARGET_UNSUPPORTED');
  });

  it('bounds issue output deterministically without claiming unavailable load metadata', () => {
    const result = buildAudioAssetCompatibilityAudit('web-desktop', [
      { reference: ref('one'), info: { type: 'cc.AudioClip', url: 'db://assets/one.flac', importer: 'audio' } },
      { reference: ref('two'), info: { type: 'cc.AudioClip', url: 'db://assets/two.flac', importer: 'audio' } },
    ], 1);
    assert.equal(result.valid, false);
    assert.equal(result.complete, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].assetId, 'one');
    assert.equal(result.items[0].issues.length, 1);
    assert.equal(result.items[1].issues.length, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(result.items[0], 'loadMode'), false);
  });

  it('documents the bounded POST registration and conservative scope', () => {
    const source = readSource('utcp/tools/expansion-tools.ts');
    const start = source.indexOf("'audioAssetCompatibilityAudit'");
    const end = source.indexOf("'assetImporterAudit'", start);
    const slice = source.slice(start, end);
    assert.match(slice, /maxItems: 64/);
    assert.match(slice, /maxIssues/);
    assert.match(slice, /'POST'/);
    assert.match(slice, /query-asset-info/);
    assert.doesNotMatch(slice, /query-path|executeJavascript|readFile|duration\s*:|decode\s*\(/);
  });

  it('rejects malformed lists and target values before querying the asset database', async () => {
    const mock = createAssetRequest({});
    global.Editor = { Message: { request: mock.request } };
    const tools = new ExpansionTools();
    await assert.rejects(tools.audioAssetCompatibilityAudit({ assets: [], target: 'web-mobile' }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    await assert.rejects(tools.audioAssetCompatibilityAudit({ assets: [ref('x')], target: 'console' }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    await assert.rejects(tools.audioAssetCompatibilityAudit({ assets: [{ id: 'x', type: 'cc.Texture2D' }], target: 'web-mobile' }), (error) => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    assert.deepEqual(mock.calls, []);
    delete global.Editor;
  });

  it('does not misreport asset database failures as missing assets', async () => {
    global.Editor = { Message: { request: async () => { throw new Error('asset-db unavailable'); } } };
    await assert.rejects(
      new ExpansionTools().audioAssetCompatibilityAudit({ assets: [ref('one')], target: 'web-mobile' }),
      (error) => error.code === 'ASSET_QUERY_FAILED' && error.status === 502,
    );
    delete global.Editor;
  });

  it('queries each explicitly typed reference through public asset-db info and preserves order', async () => {
    const mock = createAssetRequest({
      one: { uuid: 'one', type: 'cc.AudioClip', url: 'db://assets/one.ogg', importer: 'audio' },
      two: { uuid: 'two', type: 'cc.Texture2D', url: 'db://assets/two.png', importer: 'texture' },
    });
    global.Editor = { Message: { request: mock.request } };
    const result = await new ExpansionTools().audioAssetCompatibilityAudit({
      assets: [ref('one'), ref('two'), ref('missing')],
      target: 'native-mobile',
    });
    assert.deepEqual(mock.calls.map((call) => call.id), ['one', 'two', 'missing']);
    assert.deepEqual(result.items.map((item) => item.reference.id), ['one', 'two', 'missing']);
    assert.equal(result.items[1].issues[0].code, 'TYPE_MISMATCH');
    assert.equal(result.items[2].issues[0].code, 'ASSET_NOT_FOUND');
    delete global.Editor;
  });
});
