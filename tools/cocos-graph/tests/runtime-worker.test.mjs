import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeUuid } from '../src/parser.mjs';
const workerPath = fileURLToPath(new URL('../runtime-worker.mjs', import.meta.url));
const fixturePath = fileURLToPath(new URL('./fixtures/creator-2x.fire.json', import.meta.url));

function execute(operation, input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { operation, input } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  });
}

function disposableProject() {
  const project = mkdtempSync(join(tmpdir(), 'cocos-graph-worker-'));
  mkdirSync(join(project, 'assets', 'levels'), { recursive: true });
  copyFileSync(fixturePath, join(project, 'assets', 'levels', 'level.fire'));
  const outDir = join(project, '.cocos-graph', 'cocos-pilot');
  mkdirSync(outDir, { recursive: true });
  return { project, outDir };
}

test('explicit 2.4 disk build then bounded query, resolve, navigate, refs and validate', async () => {
  const input = disposableProject();
  try {
    const missing = await execute('query', { ...input, bundle: 'levels' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'GRAPH_NOT_BUILT');
    assert.equal(existsSync(join(input.outDir, '_manifest.json')), false, 'read must not auto-build');

    const built = await execute('build', { ...input, bundle: 'levels' });
    assert.equal(built.ok, true);
    assert.equal(built.result.shards[0].graphAvailable, true);
    const query = await execute('query', { ...input, bundle: 'levels', query: { limit: 1 } });
    assert.equal(query.ok, true);
    assert.equal(query.result.handles.length, 1);
    assert.equal(query.result.truncated, true);
    assert.match(query.result.handles[0].handle, /^assets\/levels\/level\.fire#/);
    assert.equal(query.result.handles[0].source, 'disk');
    const resolved = await execute('resolve', { ...input, bundle: 'levels', locator: { uuid: 'node-stable-2x' } });
    assert.equal(resolved.result.status, 'resolved');
    assert.equal(resolved.result.node.name, 'Stable');
    const parents = await execute('navigate', { ...input, bundle: 'levels', navigation: { handle: resolved.result.node.handle, relation: 'ancestors' } });
    assert.equal(parents.result.handles[0].name, 'Scene2x');
    const refs = await execute('refs', { ...input, bundle: 'levels', assetUuid: decodeUuid('fcmR3XADNLgJ1ByKhqcC5Z') });
    assert.equal(refs.result.refs.length, 1);
    const valid = await execute('validate', { ...input, bundle: 'levels' });
    assert.equal(valid.result.valid, true);
    assert.equal(valid.result.source, 'disk');
  } finally { rmSync(input.project, { recursive: true, force: true }); }
});

test('rejects traversal, project-external cache and symlinked shard without reading outside', async () => {
  const input = disposableProject();
  const outside = mkdtempSync(join(tmpdir(), 'cocos-graph-external-'));
  try {
    const traversal = await execute('build', { ...input, bundle: '../external' });
    assert.equal(traversal.code, 'GRAPH_PATH_INVALID');
    const external = await execute('build', { ...input, outDir: outside, bundle: 'levels' });
    assert.equal(external.code, 'GRAPH_PATH_INVALID');
    const built = await execute('build', { ...input, bundle: 'levels' });
    assert.equal(built.ok, true);
    const manifestPath = join(input.outDir, '_manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.shards[0].graphFile = '../../outside.json';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const escaped = await execute('query', { ...input, bundle: 'levels' });
    assert.equal(escaped.code, 'GRAPH_PATH_INVALID');
    manifest.shards[0].graphFile = 'linked/external.json';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(outside, 'external.json'), '{}');
    symlinkSync(outside, join(input.outDir, 'linked'), 'junction');
    const linked = await execute('query', { ...input, bundle: 'levels' });
    assert.equal(linked.code, 'GRAPH_PATH_INVALID');
    mkdirSync(join(outside, 'linked-assets'));
    symlinkSync(join(outside, 'linked-assets'), join(input.project, 'assets', 'linked'), 'junction');
    const linkedAsset = await execute('build', { ...input });
    assert.equal(linkedAsset.code, 'GRAPH_PATH_INVALID');
  } finally {
    rmSync(input.project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
