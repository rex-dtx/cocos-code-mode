import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSceneText } from './parser.mjs';
import { treeToGraph, unwrapLiveSnapshot, validateLiveGraph } from './live.mjs';
import { PARSER_VERSION, makeManifest } from './manifest.mjs';
import { acquireNamespaceLock, readJson, removeUnreferencedGraphs, writeJsonAtomic } from './storage.mjs';

import { assertBundleName, resolveInside } from './path-safety.mjs';
export function semanticHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function shardOf(assetsRoot, filepath) {
  return relative(assetsRoot, filepath).replace(/\\/g, '/').split('/')[0] || '_root';
}

function listScenePrefab(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !['library', 'temp', 'build', 'node_modules'].includes(entry.name)) walk(path);
      } else if (path.endsWith('.scene') || path.endsWith('.prefab')) files.push(path);
    }
  };
  walk(root);
  return files.sort();
}

function recordsForFile(graph, file) {
  return {
    nodes: (graph?.nodes ?? []).filter((record) => record.file === file),
    comps: (graph?.comps ?? []).filter((record) => record.file === file),
    refs: (graph?.refs ?? []).filter((record) => record.file === file),
  };
}

function previousGraph(outDir, manifest, bundle) {
  if (manifest?.parserVersion !== PARSER_VERSION) return null;
  const record = manifest.shards?.find((shard) => shard.name === bundle);
  if (!record?.graphFile || !record.sha256) return null;
  const graph = readJson(resolveInside(outDir, record.graphFile, 'manifest graphFile'));
  if (!graph || graph.version !== PARSER_VERSION || graph.bundle !== bundle) return null;
  const { builtAt: _builtAt, manifestBuiltAt: _manifestBuiltAt, ...stable } = graph;
  return semanticHash(stable) === record.sha256 ? graph : null;
}

function readLivePayload(liveJsonPath, project, bundle, diskFiles) {
  if (!liveJsonPath) return null;
  if (!existsSync(liveJsonPath)) throw new Error(`live snapshot not found: ${liveJsonPath}`);
  const raw = readFileSync(liveJsonPath, 'utf8');
  const payload = JSON.parse(raw);
  const live = unwrapLiveSnapshot(payload);
  const sourceFile = live.sourceFile.startsWith('assets/')
    ? live.sourceFile
    : relative(project, join(project, live.sourceFile)).replace(/\\/g, '/');
  if (!sourceFile.startsWith(`assets/${bundle}/`)) throw new Error(`live snapshot sourceFile ${sourceFile} is outside bundle ${bundle}`);
  const matches = diskFiles.filter((path) => relative(project, path).replace(/\\/g, '/') === sourceFile);
  if (matches.length !== 1) throw new Error(`live snapshot sourceFile ${sourceFile} did not resolve uniquely in bundle ${bundle}`);
  return { ...live, sourceFile, raw };
}

export function buildShard({ project, bundle, files, liveJsonPath, previous }) {
  const live = readLivePayload(liveJsonPath, project, bundle, files);
  const previousFiles = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  const nodes = [];
  const comps = [];
  const refs = [];
  const filesMeta = [];
  let prefabOpaque = false;
  let parsedFiles = 0;
  let reusedFiles = 0;

  for (const filepath of files) {
    const file = relative(project, filepath).replace(/\\/g, '/');
    if (live?.sourceFile === file) {
      const graph = treeToGraph(live.tree, { file, source: 'live' });
      validateLiveGraph(graph);
      nodes.push(...graph.nodes);
      comps.push(...graph.comps);
      refs.push(...graph.refs);
      filesMeta.push({ path: file, source: 'live', mtime: Date.now(), size: live.raw.length, sha256: semanticHash(live.raw) });
      parsedFiles++;
      continue;
    }

    const text = readFileSync(filepath, 'utf8');
    const stat = statSync(filepath);
    const hash = semanticHash(text);
    const oldMeta = previousFiles.get(file);
    let fileOpaque = false;
    if (previous && oldMeta?.sha256 === hash) {
      const old = recordsForFile(previous, file);
      nodes.push(...old.nodes);
      comps.push(...old.comps);
      refs.push(...old.refs);
      fileOpaque = oldMeta.prefabOpaque === true;
      reusedFiles++;
    } else {
      const parsed = parseSceneText(text, { file, source: 'disk' });
      nodes.push(...parsed.nodes);
      comps.push(...parsed.comps);
      refs.push(...parsed.refs);
      fileOpaque = parsed.prefabOpaque;
      parsedFiles++;
    }
    prefabOpaque ||= fileOpaque;
    filesMeta.push({ path: file, source: 'disk', mtime: Math.trunc(stat.mtimeMs), size: stat.size, sha256: hash, prefabOpaque: fileOpaque });
  }

  const source = live ? (files.length > 1 ? 'mixed' : 'live') : (files.length ? 'disk' : 'empty');
  const dirty = live?.dirty ?? 'unknown';
  const builtAt = Date.now();
  const stable = { version: PARSER_VERSION, dirty, prefabOpaque, bundle, source, files: filesMeta, nodes, comps, refs };
  const hash = semanticHash(stable);
  return {
    graph: { ...stable, builtAt },
    record: {
      name: bundle,
      source,
      files: filesMeta.length,
      bytes: filesMeta.reduce((sum, item) => sum + item.size, 0),
      sha256: hash,
      graphFile: `${bundle}/graph-${hash}.json`,
      builtAt,
      prefabOpaque,
      dirty,
      parsedFiles,
      reusedFiles,
      ...(live ? { liveScene: live.sourceFile, liveNodes: nodes.filter((node) => node.source === 'live').length } : {}),
    },
  };
}

export function buildAll({ project, outDir, liveJsonByBundle, bundleFilter, lockOptions } = {}) {
  const assetsRoot = join(project, 'assets');
  if (bundleFilter) assertBundleName(bundleFilter);
  if (!existsSync(assetsRoot)) throw new Error(`assets/ not found under ${project}`);
  const release = acquireNamespaceLock(outDir, lockOptions);
  try {
    const manifestPath = join(outDir, '_manifest.json');
    const oldManifest = readJson(manifestPath);
    const scanRoot = bundleFilter ? join(assetsRoot, bundleFilter) : assetsRoot;
    const allFiles = listScenePrefab(scanRoot);
    const byShard = new Map();
    for (const file of allFiles) {
      const bundle = bundleFilter ?? shardOf(assetsRoot, file);
      if (!byShard.has(bundle)) byShard.set(bundle, []);
      byShard.get(bundle).push(file);
    }
    for (const bundle of Object.keys(liveJsonByBundle ?? {})) {
      if (bundleFilter && bundle !== bundleFilter) continue;
      assertBundleName(bundle);
      if (!byShard.has(bundle)) byShard.set(bundle, []);
    }
    if (bundleFilter && !byShard.has(bundleFilter)) byShard.set(bundleFilter, []);

    // Build every selected shard fully in memory before publishing any generation.
    const built = [];
    for (const [bundle, files] of [...byShard].sort(([a], [b]) => a.localeCompare(b))) {
      built.push(buildShard({
        project,
        bundle,
        files,
        liveJsonPath: liveJsonByBundle?.[bundle] ?? null,
        previous: previousGraph(outDir, oldManifest, bundle),
      }));
    }

    const previous = bundleFilter && oldManifest?.parserVersion === PARSER_VERSION ? oldManifest : null;
    for (const item of built) writeJsonAtomic(join(outDir, item.record.graphFile), item.graph);
    const manifest = makeManifest(built.map((item) => item.record), previous);
    writeJsonAtomic(manifestPath, manifest);
    removeUnreferencedGraphs(outDir, manifest, { graceMs: 0 });
    return manifest;
  } finally {
    release();
  }
}
