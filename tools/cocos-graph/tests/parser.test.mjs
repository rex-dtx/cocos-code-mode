import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeUuid, parseEntries, parseSceneText } from '../src/parser.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('decodeUuid', () => {
  it('decodes the engine docstring golden vector', () => {
    // From cocos/core/utils/decode-uuid.ts docstring
    assert.equal(decodeUuid('fcmR3XADNLgJ1ByKhqcC5Z'), 'fc991dd7-0033-4b80-9d41-c8a86a702e59');
  });
  it('passes through non-22 strings and 22-char non-compressed', () => {
    assert.equal(decodeUuid('deadbeef-dead-beef-dead-beefdeadbeef'), 'deadbeef-dead-beef-dead-beefdeadbeef');
    assert.equal(decodeUuid(''), '');
    assert.equal(decodeUuid('short'), 'short');
  });
  it('preserves @ sub-id suffix', () => {
    const withSub = 'fcmR3XADNLgJ1ByKhqcC5Z@12345';
    const decoded = decodeUuid(withSub);
    assert.ok(decoded.endsWith('@12345'));
    assert.ok(decoded.startsWith('fc991dd7-0033-4b80'));
  });
});

describe('parseEntries', () => {
  it('parses the golden fixture and returns expected nodes/comps/refs', () => {
    const text = readFileSync(join(fixturesDir, 'mini.scene.json'), 'utf8');
    const arr = JSON.parse(text);
    const { nodes, comps, refs, prefabOpaque } = parseEntries(arr);
    assert.equal(nodes.length, 4, '3 cc.Node + 1 cc.Scene');
    assert.ok(nodes.some((n) => n.uuid === 'node-a-uuid' && n.name === 'Player'));
    assert.ok(nodes.some((n) => n.uuid === 'node-b-uuid' && n.name === 'Enemy'));
    assert.ok(prefabOpaque, 'Enemy has _prefab → shard is opaque');
    const sprite = comps.find((c) => c.node === 'node-a-uuid' && c.type === 'cc.Sprite');
    assert.ok(sprite, 'Player should have cc.Sprite via _components');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].uuid, 'fc991dd7-0033-4b80-9d41-c8a86a702e59');
    assert.equal(refs[0].node, 'node-a-uuid');
  });
  it('throws when a cc.Node lacks _id (stable identity required)', () => {
    assert.throws(() => parseEntries([{ __type__: 'cc.Node', _name: 'Nameless' }]), /has no _id/);
  });
  it('parseSceneText rejects non-array JSON', () => {
    assert.throws(() => parseSceneText('{"foo":1}'), /expected the flat serialized array/);
  });
  it('parseSceneText throws on invalid JSON', () => {
    assert.throws(() => parseSceneText('{bad'), /invalid JSON/);
  });
  it('never uses __id__ as a persisted key', () => {
    const text = readFileSync(join(fixturesDir, 'mini.scene.json'), 'utf8');
    const { nodes } = parseEntries(JSON.parse(text));
    for (const n of nodes) assert.ok(!String(n.uuid).startsWith('__id__'), `uuid must not be __id__: ${n.uuid}`);
  });
});
