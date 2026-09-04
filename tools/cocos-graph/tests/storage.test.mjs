import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireNamespaceLock, readJson, writeJsonAtomic } from '../src/storage.mjs';
import { loadShard } from '../src/query.mjs';

const exec = promisify(execFile);
const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'mini.scene.json'), 'utf8');

describe('transactional graph storage', () => {
  it('atomically replaces JSON without leaving temp files', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-graph-atomic-'));
    const path = join(root, 'nested', 'value.json');
    try {
      writeJsonAtomic(path, { value: 1 });
      writeJsonAtomic(path, { value: 2 });
      assert.deepEqual(readJson(path), { value: 2 });
      assert.deepEqual(Object.keys(readJson(path)), ['value']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('times out on an active lock and recovers a stale lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'cocos-graph-lock-'));
    try {
      const release = acquireNamespaceLock(root);
      assert.throws(() => acquireNamespaceLock(root, { timeoutMs: 20, staleMs: 10000 }), /timed out waiting/);
      release();
      const lock = join(root, '.build-lock');
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 0, createdAt: Date.now() - 60000 }));
      const releaseRecovered = acquireNamespaceLock(root, { timeoutMs: 100, staleMs: 10 });
      releaseRecovered();
      assert.equal(existsSync(lock), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('serializes two real build processes in the same namespace', async () => {
    const project = mkdtempSync(join(tmpdir(), 'cocos-graph-concurrent-'));
    const bundleDir = join(project, 'assets', 'bundle');
    const outDir = join(project, '.cocos-graph');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'a.scene'), fixture);
    const cli = join(import.meta.dirname, '..', 'bin', 'cocos-graph.mjs');
    try {
      const args = [cli, 'build', '--project', project, '--bundle', 'bundle', '--out', '.cocos-graph'];
      const [a, b] = await Promise.all([exec(process.execPath, args), exec(process.execPath, args)]);
      assert.equal(JSON.parse(a.stdout).ok, true);
      assert.equal(JSON.parse(b.stdout).ok, true);
      assert.doesNotThrow(() => loadShard(outDir, 'bundle'));
      const manifest = readJson(join(outDir, '_manifest.json'));
      assert.equal(manifest.shards.length, 1);
      assert.equal(existsSync(join(outDir, '.build-lock')), false);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });
});
