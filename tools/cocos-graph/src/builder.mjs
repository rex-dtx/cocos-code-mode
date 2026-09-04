// Per-shard build: disk parse + optional live sourcing for the open scene's shard.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeUuid, parseEntries } from './parser.mjs';
import { treeToGraph } from './live.mjs';
import { PARSER_VERSION, makeManifest } from './manifest.mjs';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function shardOf(assetsRoot, filepath) {
  const rel = relative(assetsRoot, filepath).replace(/\\/g, '/');
  return rel.split('/')[0] || '_root';
}

function listScenePrefab(assetsRoot) {
  const out = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name.startsWith('.') || ent.name === 'library' || ent.name === 'temp' || ent.name === 'build' || ent.name === 'node_modules') continue; walk(p); }
      else if (p.endsWith('.scene') || p.endsWith('.prefab')) out.push(p);
    }
  }
  walk(assetsRoot);
  return out;
}

export function buildShard({ project, bundle, assetsRoot, files, liveJsonPath }) {
  let nodes = [];
  let comps = [];
  let refs = [];
  let prefabOpaque = false;
  const filesMeta = [];
  let source = files.length ? 'disk' : 'empty';
  let liveNodes = null;
  let liveScene = null;

  if (liveJsonPath && existsSync(liveJsonPath)) {
    const liveRaw = readFileSync(liveJsonPath, 'utf8');
    const live = JSON.parse(liveRaw);
    const graph = treeToGraph(live);
    nodes = graph.nodes;
    comps = graph.comps;
    refs = graph.refs;
    source = 'live';
    liveNodes = nodes.length;
    liveScene = live.reference?.id ?? null;
    prefabOpaque = false;
    filesMeta.push({
      path: `live:${bundle}`,
      mtime: Date.now(),
      size: liveRaw.length,
      sha256: sha256(liveRaw),
    });
  } else {
    for (const filepath of files) {
      const text = readFileSync(filepath, 'utf8');
      const stat = statSync(filepath);
      const rel = relative(project, filepath).replace(/\\/g, '/');
      const arr = JSON.parse(text);
      const parsed = parseEntries(arr);
      if (parsed.prefabOpaque) prefabOpaque = true;
      const filePrefix = rel;
      for (const n of parsed.nodes) n.file = filePrefix;
      nodes.push(...parsed.nodes);
      comps.push(...parsed.comps);
      refs.push(...parsed.refs);
      filesMeta.push({ path: rel, mtime: stat.mtimeMs | 0, size: stat.size, sha256: sha256(text) });
    }
  }

  return {
    bundle,
    source,
    filesMeta,
    graph: { version: PARSER_VERSION, builtAt: Date.now(), dirty: false, prefabOpaque, bundle, source, files: filesMeta, nodes, comps, refs },
    liveNodes,
    liveScene,
  };
}

export function buildAll({ project, outDir, liveJsonByBundle }) {
  const assetsRoot = join(project, 'assets');
  if (!existsSync(assetsRoot)) throw new Error(`assets/ not found under ${project}`);
  const allFiles = listScenePrefab(assetsRoot);
  const byShard = new Map();
  for (const f of allFiles) {
    const shard = shardOf(assetsRoot, f);
    if (!byShard.has(shard)) byShard.set(shard, []);
    byShard.get(shard).push(f);
  }
  const bundles = liveJsonByBundle ? new Set([...byShard.keys(), ...Object.keys(liveJsonByBundle)]) : byShard.keys();
  const shardRecords = [];
  for (const bundle of bundles) {
    const files = byShard.get(bundle) ?? [];
    const liveJson = liveJsonByBundle?.[bundle] ?? null;
    const result = buildShard({ project, bundle, assetsRoot, files, liveJsonPath: liveJson });
    const shardDir = join(outDir, bundle);
    mkdirSync(shardDir, { recursive: true });
    const graphPath = join(shardDir, 'graph.json');
    writeFileSync(graphPath, JSON.stringify(result.graph, null, 2), 'utf8');
    const bytes = result.graph.files.reduce((sum, f) => sum + (f.size | 0), 0);
    shardRecords.push({ name: bundle, source: result.source, files: files.length, bytes, sha256: sha256(JSON.stringify(result.graph)), prefabOpaque: result.graph.prefabOpaque, ...(result.liveScene ? { liveScene: result.liveScene, liveNodes: result.liveNodes } : {}) });
  }
  const manifest = makeManifest(shardRecords);
  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}
