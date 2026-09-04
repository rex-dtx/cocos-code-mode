import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAll } from '../src/builder.mjs';
import { loadShard } from '../src/query.mjs';

const fixtures = join(import.meta.dirname, 'fixtures');
const fixture = (name) => readFileSync(join(fixtures, name), 'utf8');

function projectWithBundles() {
  const project = mkdtempSync(join(tmpdir(), 'cocos-graph-v4-'));
  for (const bundle of ['bundle-a', 'bundle-b']) mkdirSync(join(project, 'assets', bundle), { recursive: true });
  writeFileSync(join(project, 'assets', 'bundle-a', 'a.scene'), fixture('mini.scene.json'));
  writeFileSync(join(project, 'assets', 'bundle-a', 'b.scene'), fixture('duplicate.scene.json'));
  writeFileSync(join(project, 'assets', 'bundle-b', 'only.scene'), fixture('mini.scene.json'));
  return project;
}

describe('builder schema v4 integrity', () => {
  it('builds versioned generations and rejects schema v3 with rebuild recovery', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      const manifest = buildAll({ project, outDir });
      assert.equal(manifest.parserVersion, '4');
      assert.ok(manifest.shards.every((shard) => /^.+\/graph-[a-f0-9]{16}\.json$/.test(shard.graphFile)));
      const graph = loadShard(outDir, 'bundle-a');
      assert.equal(graph.version, '4');
      const stale = { ...manifest, parserVersion: '3' };
      writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(stale));
      assert.throws(() => loadShard(outDir, 'bundle-a'), /version "4" required.*run: cocos-graph build/);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('build --bundle scope preserves and does not rewrite other shard generations', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      const first = buildAll({ project, outDir });
      const untouched = first.shards.find((shard) => shard.name === 'bundle-b');
      writeFileSync(join(project, 'assets', 'bundle-a', 'a.scene'), fixture('duplicate.scene.json'));
      const second = buildAll({ project, outDir, bundleFilter: 'bundle-a' });
      assert.deepEqual(second.shards.find((shard) => shard.name === 'bundle-b'), untouched);
      assert.equal(second.shards.length, 2);
      assert.ok(existsSync(join(outDir, untouched.graphFile)));
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('full rebuild drops bundles deleted from assets', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      buildAll({ project, outDir });
      rmSync(join(project, 'assets', 'bundle-b'), { recursive: true, force: true });
      const manifest = buildAll({ project, outDir });
      assert.deepEqual(manifest.shards.map((shard) => shard.name), ['bundle-a']);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('overlays one live scene while retaining unrelated disk files', () => {
    const project = projectWithBundles();
    const livePath = join(project, 'live.json');
    const live = JSON.parse(fixture('live-overlay.json'));
    live.sourceFile = 'assets/bundle-a/a.scene';
    writeFileSync(livePath, JSON.stringify(live));
    const outDir = join(project, '.cocos-graph');
    try {
      const manifest = buildAll({ project, outDir, bundleFilter: 'bundle-a', liveJsonByBundle: { 'bundle-a': livePath } });
      const shard = manifest.shards.find((item) => item.name === 'bundle-a');
      assert.equal(shard.source, 'mixed');
      assert.equal(shard.dirty, true);
      const graph = loadShard(outDir, 'bundle-a');
      assert.ok(graph.nodes.some((node) => node.name === 'LivePlayer' && node.source === 'live'));
      assert.ok(graph.nodes.some((node) => node.name === 'OtherPlayer' && node.file.endsWith('/b.scene') && node.source === 'disk'));
      assert.equal(graph.nodes.some((node) => node.file.endsWith('/a.scene') && node.source === 'disk'), false);
      assert.equal(graph.files.length, 2);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('reuses unchanged file records and reparses only changed files', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      buildAll({ project, outDir, bundleFilter: 'bundle-a' });
      const unchanged = buildAll({ project, outDir, bundleFilter: 'bundle-a' }).shards.find((item) => item.name === 'bundle-a');
      assert.equal(unchanged.parsedFiles, 0);
      assert.equal(unchanged.reusedFiles, 2);
      writeFileSync(join(project, 'assets', 'bundle-a', 'a.scene'), fixture('duplicate.scene.json'));
      const changed = buildAll({ project, outDir, bundleFilter: 'bundle-a' }).shards.find((item) => item.name === 'bundle-a');
      assert.equal(changed.parsedFiles, 1);
      assert.equal(changed.reusedFiles, 1);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('keeps the last valid manifest and graph when parsing fails', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      buildAll({ project, outDir, bundleFilter: 'bundle-a' });
      const manifestBefore = readFileSync(join(outDir, '_manifest.json'), 'utf8');
      writeFileSync(join(project, 'assets', 'bundle-a', 'a.scene'), '{broken');
      assert.throws(() => buildAll({ project, outDir, bundleFilter: 'bundle-a' }), /invalid JSON/);
      assert.equal(readFileSync(join(outDir, '_manifest.json'), 'utf8'), manifestBefore);
      assert.doesNotThrow(() => loadShard(outDir, 'bundle-a'));
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('detects a tampered graph generation', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      const manifest = buildAll({ project, outDir, bundleFilter: 'bundle-a' });
      const graphPath = join(outDir, manifest.shards[0].graphFile);
      const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
      graph.nodes[0].name = 'tampered';
      writeFileSync(graphPath, JSON.stringify(graph));
      assert.throws(() => loadShard(outDir, 'bundle-a'), /stale or unreadable/);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('rejects bundle and manifest path traversal', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    try {
      assert.throws(() => buildAll({ project, outDir, bundleFilter: '../outside' }), /invalid top-level bundle/);
      const manifest = buildAll({ project, outDir, bundleFilter: 'bundle-a' });
      manifest.shards[0].graphFile = '../outside.json';
      writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest));
      assert.throws(() => loadShard(outDir, 'bundle-a'), /escapes cache root/);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });

  it('fails live overlay without unique source provenance before writing', () => {
    const project = projectWithBundles();
    const outDir = join(project, '.cocos-graph');
    const livePath = join(project, 'live.json');
    writeFileSync(livePath, JSON.stringify({ tree: { children: [] } }));
    try {
      assert.throws(() => buildAll({ project, outDir, bundleFilter: 'bundle-a', liveJsonByBundle: { 'bundle-a': livePath } }), /requires sourceFile/);
      assert.equal(existsSync(join(outDir, '_manifest.json')), false);
    } finally { rmSync(project, { recursive: true, force: true }); }
  });
});
