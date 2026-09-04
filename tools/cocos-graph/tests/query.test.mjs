import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntries } from '../src/parser.mjs';
import { queryShard } from '../src/query.mjs';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
function fixtureGraph() {
  const arr = JSON.parse(readFileSync(join(fixturesDir, 'mini.scene.json'), 'utf8'));
  const { nodes, comps, refs, prefabOpaque } = parseEntries(arr);
  const files = [{ path: 'assets/test/mini.scene', mtime: Date.now(), size: 1352, sha256: 'abcd' }];
  return { version: '3', builtAt: Date.now(), dirty: false, prefabOpaque, bundle: 'test', source: 'disk', files, nodes, comps, refs };
}

describe('queryShard handle-first', () => {
  it('byComponent returns uuids of nodes having that component', () => {
    const g = fixtureGraph();
    const res = queryShard(g, { byComponent: 'cc.Sprite', limit: 50 });
    assert.equal(res.total, 1);
    assert.equal(res.handles[0].uuid, 'node-a-uuid');
    assert.ok(!res.handles[0].uuid.startsWith('__id__'));
  });
  it('text search is case-insensitive substring over name', () => {
    const g = fixtureGraph();
    const res = queryShard(g, { text: 'player', limit: 50 });
    assert.equal(res.total, 1);
    assert.equal(res.handles[0].name, 'Player');
  });
  it('pathGlob prefix returns subtree', () => {
    const g = fixtureGraph();
    // fixture paths are '/' for scene, then derived; Enemy is sibling of Player, ScoreLabel is child of Player
    const pref = queryShard(g, { pathGlob: '/Player/*', limit: 50 });
    assert.equal(pref.total, 1);
    assert.equal(pref.handles[0].name, 'ScoreLabel');
  });
  it('limit and cursor paginate without mutating total', () => {
    const g = fixtureGraph();
    const all = queryShard(g, { limit: 50 });
    const page1 = queryShard(g, { limit: 1, cursor: 0 });
    const page2 = queryShard(g, { limit: 1, cursor: 1 });
    assert.equal(all.total, page1.total);
    assert.equal(page1.total, page2.total);
    assert.equal(page1.handles.length, 1);
    assert.equal(page2.handles.length, 1);
    assert.notEqual(page1.handles[0].uuid, page2.handles[0].uuid);
    assert.equal(page1.truncated, true);
  });
  it('unknown component returns zero, not an error', () => {
    const g = fixtureGraph();
    const res = queryShard(g, { byComponent: 'cc.Missing', limit: 50 });
    assert.equal(res.total, 0);
    assert.equal(res.handles.length, 0);
    assert.equal(res.truncated, false);
  });
  it('result carries stale banner fields', () => {
    const g = fixtureGraph();
    const res = queryShard(g, { limit: 50 });
    assert.equal(typeof res.stale.age_ms, 'number');
    assert.equal(typeof res.stale.dirty, 'boolean');
    assert.equal(typeof res.stale.prefabOpaque, 'boolean');
  });
  it('never returns a blob — each handle has at most uuid/path/name/file', () => {
    const g = fixtureGraph();
    const res = queryShard(g, { limit: 50 });
    for (const h of res.handles) {
      const keys = Object.keys(h).sort();
      assert.deepEqual(keys, ['file', 'name', 'path', 'uuid']);
    }
  });
});
