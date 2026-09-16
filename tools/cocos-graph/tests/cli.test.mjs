import { it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('CLI distinguishes empty queries, ambiguous identities, exact resolution, and missing caches', () => {
  const project = mkdtempSync(join(tmpdir(), 'cocos-graph-cli-'));
  const cli = join(import.meta.dirname, '../bin/cocos-graph.mjs');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--project', project, '--out', '.cocos-graph'], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  };
  try {
    const bundle = join(project, 'assets', 'demo');
    mkdirSync(bundle, { recursive: true });
    for (const name of ['a', 'b']) {
      writeFileSync(join(bundle, `${name}.scene`), readFileSync(join(import.meta.dirname, 'fixtures/mini.scene.json')));
    }
    const missing = run('query', '--bundle', 'demo');
    assert.equal(missing.status, 2);
    const build = run('build', '--bundle', 'demo');
    assert.equal(build.status, 0, build.stderr);
    const empty = run('query', '--bundle', 'demo', '--text', 'nonexistent-node');
    assert.equal(empty.status, 0, empty.stderr);
    assert.deepEqual(JSON.parse(empty.stdout).handles, []);
    assert.equal(JSON.parse(empty.stdout).total, 0);
    const ambiguous = run('resolve', '--bundle', 'demo', '--uuid', 'node-a-uuid');
    assert.equal(ambiguous.status, 3, ambiguous.stderr);
    assert.deepEqual(JSON.parse(ambiguous.stdout).candidates.map((item) => item.file).sort(), [
      'assets/demo/a.scene', 'assets/demo/b.scene',
    ]);
    const exact = run('resolve', '--bundle', 'demo', '--handle', 'assets/demo/b.scene#node-a-uuid');
    assert.equal(exact.status, 0, exact.stderr);
    assert.equal(JSON.parse(exact.stdout).node.file, 'assets/demo/b.scene');
    const unknown = run('resolve', '--bundle', 'demo', '--uuid', 'absent-node');
    assert.equal(unknown.status, 2, unknown.stderr);
    assert.equal(JSON.parse(unknown.stdout).status, 'not_found');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
