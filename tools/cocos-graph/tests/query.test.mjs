import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEntries, parseSceneText } from '../src/parser.mjs';
import { findAssetRefs, navigate, queryShard, resolveNode } from '../src/query.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');
function graph() {
  const a = parseSceneText(readFileSync(join(fixtures, 'mini.scene.json'), 'utf8'), { file: 'assets/test/a.scene' });
  const b = parseSceneText(readFileSync(join(fixtures, 'duplicate.scene.json'), 'utf8'), { file: 'assets/test/b.scene' });
  return { version: '4', builtAt: Date.now(), dirty: 'unknown', prefabOpaque: true, bundle: 'test', source: 'disk', files: [], nodes: [...a.nodes, ...b.nodes], comps: [...a.comps, ...b.comps], refs: [...a.refs, ...b.refs] };
}

describe('query and resolve schema v4', () => {
  it('returns deterministic provenance-rich handles and composes filters', () => {
    const result = queryShard(graph(), { byComponent: 'cc.Sprite', text: 'player', explain: true, limit: 50 });
    assert.equal(result.total, 2);
    assert.deepEqual(result.handles.map((item) => item.handle), [...result.handles.map((item) => item.handle)].sort());
    assert.ok(result.handles.every((item) => item.file && item.source && item.bundle === 'test'));
    assert.match(result.handles[0].reason, /component:cc\.Sprite AND text:player/);
    assert.equal(result.stale.dirty, 'unknown');
    assert.equal(result.stale.advisory, true);
  });

  it('never chooses an ambiguous bare engine UUID', () => {
    const result = resolveNode(graph(), { uuid: 'node-a-uuid' });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.candidates.length, 2);
    assert.notEqual(result.candidates[0].file, result.candidates[1].file);
  });

  it('resolves an exact composite handle and unique UUID', () => {
    const g = graph();
    const exact = resolveNode(g, { handle: 'assets/test/a.scene#node-a-uuid' });
    assert.equal(exact.status, 'resolved');
    assert.equal(exact.node.file, 'assets/test/a.scene');
    const unique = resolveNode(g, { uuid: 'node-c-uuid' });
    assert.equal(unique.status, 'resolved');
    assert.equal(unique.node.name, 'ScoreLabel');
  });

  it('navigates bounded ancestors, children, and descendants', () => {
    const g = graph();
    const player = 'assets/test/a.scene#node-a-uuid';
    const child = 'assets/test/a.scene#node-c-uuid';
    assert.deepEqual(navigate(g, { handle: player, relation: 'children' }).handles.map((item) => item.handle), [child]);
    assert.equal(navigate(g, { handle: child, relation: 'ancestors', depth: 1 }).handles[0].handle, player);
    assert.equal(navigate(g, { handle: 'assets/test/a.scene#scene-root-uuid', relation: 'descendants', depth: 1 }).total, 2);
  });

  it('looks up component instances by stable component id', () => {
    const result = queryShard(graph(), { componentUuid: 'comp-label-c' });
    assert.equal(result.total, 1);
    assert.equal(result.handles[0].name, 'ScoreLabel');
  });

  it('returns asset references with owning node and property provenance', () => {
    const result = findAssetRefs(graph(), { uuid: 'fc991dd7-0033-4b80-9d41-c8a86a702e59' });
    assert.equal(result.total, 2);
    assert.ok(result.refs.every((ref) => ref.node.includes('#node-a-uuid')));
    assert.ok(result.refs.every((ref) => ref.file && ref.prop.startsWith('cc.Sprite.')));
  });

  it('paginates every identity exactly once and returns a terminal cursor', () => {
    const g = graph();
    const first = queryShard(g, { limit: 2 });
    const second = queryShard(g, { limit: 2, cursor: first.cursor });
    const last = queryShard(g, { limit: 2, cursor: second.cursor });
    assert.deepEqual(first.handles.map((item) => item.handle), [
      'assets/test/a.scene#node-a-uuid', 'assets/test/a.scene#node-b-uuid',
    ]);
    assert.deepEqual(second.handles.map((item) => item.handle), [
      'assets/test/a.scene#node-c-uuid', 'assets/test/a.scene#scene-root-uuid',
    ]);
    assert.deepEqual(last.handles.map((item) => item.handle), [
      'assets/test/b.scene#duplicate-scene', 'assets/test/b.scene#node-a-uuid',
    ]);
    assert.deepEqual([first.total, second.total, last.total], [6, 6, 6]);
    assert.deepEqual([first.cursor, second.cursor, last.cursor], [2, 4, null]);
    assert.deepEqual([first.truncated, second.truncated, last.truncated], [true, true, false]);
  });
});

describe('query edge behavior', () => {
  it('composes decoded script, component, path, and text filters without duplicate owners', () => {
    const parsed = parseEntries([
      { __type__: 'cc.Node', _id: 'root', _name: 'Panel' },
      { __type__: 'cc.Node', _id: 'match', _name: 'Player', _parent: { __id__: 0 }, _components: [{ __id__: 4 }, { __id__: 5 }, { __id__: 6 }] },
      { __type__: 'cc.Node', _id: 'outside', _name: 'Player', _components: [{ __id__: 4 }, { __id__: 6 }] },
      { __type__: 'cc.Node', _id: 'wrong-script', _name: 'Player', _parent: { __id__: 0 }, _components: [{ __id__: 6 }] },
      { __type__: 'fcmR3XADNLgJ1ByKhqcC5Z', _id: 'controller-one' },
      { __type__: 'fcmR3XADNLgJ1ByKhqcC5Z', _id: 'controller-two' },
      { __type__: 'cc.Sprite', _id: 'sprite' },
    ], { file: 'assets/test/scripts.scene' });
    const g = { ...graph(), ...parsed };
    const filters = {
      byScript: 'fc991dd7-0033-4b80-9d41-c8a86a702e59',
      byComponent: 'cc.Sprite', pathGlob: '/Panel/**', text: 'pLaYeR',
    };
    assert.deepEqual(queryShard(g, filters).handles.map((item) => item.handle), ['assets/test/scripts.scene#match']);
    assert.deepEqual(queryShard(g, { ...filters, byScript: 'missing-script' }).handles, []);
    assert.deepEqual(queryShard(g, { ...filters, byComponent: 'cc.Label' }).handles, []);
    assert.deepEqual(queryShard(g, { ...filters, text: 'enemy' }).handles, []);
  });

  it('treats exact paths separately from recursive path globs', () => {
    const g = graph();
    assert.deepEqual(queryShard(g, { pathGlob: '/Player' }).handles.map((item) => item.handle), [
      'assets/test/a.scene#node-a-uuid',
    ]);
    assert.deepEqual(queryShard(g, { pathGlob: '/Player/**' }).handles.map((item) => item.handle), [
      'assets/test/a.scene#node-a-uuid',
      'assets/test/a.scene#node-c-uuid',
    ]);
  });
  it('returns an empty page for missing hierarchy handles and preserves relation metadata', () => {
    const result = navigate(graph(), { handle: 'assets/test/missing.scene#missing', relation: 'children' });
    assert.equal(result.total, 0);
    assert.deepEqual(result.handles, []);
    assert.equal(result.relation, 'children');
  });

  it('reports terminal pagination cursor for an out-of-range cursor', () => {
    const result = queryShard(graph(), { limit: 2, cursor: 100 });
    assert.equal(result.total, 6);
    assert.equal(result.cursor, null);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.handles, []);
  });
});

