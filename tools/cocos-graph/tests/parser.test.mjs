import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeUuid, makeHandle, parseEntries, parseHandle, parseSceneText } from '../src/parser.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('decodeUuid', () => {
  it('decodes the engine golden vector', () => assert.equal(decodeUuid('fcmR3XADNLgJ1ByKhqcC5Z'), 'fc991dd7-0033-4b80-9d41-c8a86a702e59'));
  it('preserves ordinary and sub-id values', () => {
    assert.equal(decodeUuid('short'), 'short');
    assert.ok(decodeUuid('fcmR3XADNLgJ1ByKhqcC5Z@sub').endsWith('@sub'));
  });
});

describe('composite handles', () => {
  it('round-trips file plus engine identity', () => {
    const handle = makeHandle('assets/a.scene', 'node-id');
    assert.deepEqual(parseHandle(handle), { file: 'assets/a.scene', uuid: 'node-id' });
  });
});

describe('parseEntries schema v4', () => {
  it('preserves engine ids, component ids, file provenance, and composite parents', () => {
    const text = readFileSync(join(fixtures, 'mini.scene.json'), 'utf8');
    const result = parseSceneText(text, { file: 'assets/test/mini.scene' });
    const player = result.nodes.find((node) => node.uuid === 'node-a-uuid');
    assert.equal(player.handle, 'assets/test/mini.scene#node-a-uuid');
    assert.equal(player.file, 'assets/test/mini.scene');
    assert.equal(player.source, 'disk');
    const child = result.nodes.find((node) => node.uuid === 'node-c-uuid');
    assert.equal(child.parent, player.handle);
    const sprite = result.comps.find((component) => component.type === 'cc.Sprite');
    assert.equal(sprite.uuid, 'comp-sprite-a');
    assert.equal(sprite.handle, 'assets/test/mini.scene#component:comp-sprite-a');
    assert.equal(sprite.node, player.handle);
    assert.equal(result.refs[0].node, player.handle);
  });

  it('keeps duplicate engine ids independent across files', () => {
    const first = parseSceneText(readFileSync(join(fixtures, 'mini.scene.json'), 'utf8'), { file: 'assets/test/a.scene' });
    const second = parseSceneText(readFileSync(join(fixtures, 'duplicate.scene.json'), 'utf8'), { file: 'assets/test/b.scene' });
    const a = first.nodes.find((node) => node.uuid === 'node-a-uuid');
    const b = second.nodes.find((node) => node.uuid === 'node-a-uuid');
    assert.notEqual(a.handle, b.handle);
    assert.equal(a.uuid, b.uuid);
  });

  it('uses prefab fileId and skips nodes with no stable identity', () => {
    const result = parseEntries([
      { __type__: 'cc.Node', _name: 'PrefabRoot', _prefab: { __id__: 1 } },
      { __type__: 'cc.PrefabInfo', fileId: 'prefab-file-id' },
      { __type__: 'cc.Node', _name: 'UnexpandedInstance' },
    ], { file: 'assets/test/x.prefab' });
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].uuid, 'prefab-file-id');
  });

  it('rejects invalid serialized input', () => {
    assert.throws(() => parseSceneText('{bad'), /invalid JSON/);
    assert.throws(() => parseEntries({}), /expected the flat serialized array/);
  });
});
