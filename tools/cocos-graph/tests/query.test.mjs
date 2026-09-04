import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSceneText } from '../src/parser.mjs';
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

  it('paginates deterministically without changing total', () => {
    const g = graph();
    const all = queryShard(g, { limit: 50 });
    const first = queryShard(g, { limit: 2, cursor: 0 });
    const second = queryShard(g, { limit: 2, cursor: 2 });
    assert.equal(first.total, all.total);
    assert.equal(second.total, all.total);
    assert.equal(first.cursor, 2);
    assert.notDeepEqual(first.handles, second.handles);
  });
});
