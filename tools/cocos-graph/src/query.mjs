import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARSER_VERSION } from './manifest.mjs';

export function loadShard(outDir, bundle) {
  const path = join(outDir, bundle, 'graph.json');
  if (!existsSync(path)) throw new Error(`cocos-graph: shard not built for bundle "${bundle}" (run: cocos-graph build ...)`);
  const text = readFileSync(path, 'utf8');
  const graph = JSON.parse(text);
  if (graph.version !== PARSER_VERSION) throw new Error(`cocos-graph: shard ${bundle} is stale or unreadable (parserVersion "${PARSER_VERSION}" expected, run build)`);
  return graph;
}

export function buildMaps(graph) {
  const byType = new Map();
  const byUuid = new Map();
  const byPath = new Map();
  const byScript = new Map();
  const nameIndex = [];
  for (const n of graph.nodes) {
    byUuid.set(n.uuid, n);
    if (n.path) byPath.set(n.path, n.uuid);
    nameIndex.push(n);
  }
  for (const c of graph.comps) {
    if (!byType.has(c.type)) byType.set(c.type, []);
    byType.get(c.type).push(c.node);
    if (c.script) {
      if (!byScript.has(c.script)) byScript.set(c.script, []);
      byScript.get(c.script).push(c.node);
    }
  }
  return { byType, byUuid, byPath, byScript, nameIndex };
}

export function queryShard(graph, { byComponent, byScript, pathGlob, text, limit = 50, cursor = 0 }) {
  const maps = buildMaps(graph);
  const limitNum = Math.max(1, Math.min(limit | 0, 200));
  const cursorNum = Math.max(0, cursor | 0);
  let hits = null;

  hits = graph.nodes.slice();
  if (byComponent) {
    const uuids = new Set(maps.byType.get(byComponent) ?? []);
    hits = hits.filter((n) => uuids.has(n.uuid));
  }
  if (byScript) {
    const uuids = new Set(maps.byScript.get(byScript) ?? []);
    hits = hits.filter((n) => uuids.has(n.uuid));
  }
  if (pathGlob) {
    const isPrefix = pathGlob.endsWith('/*') || pathGlob.endsWith('/**');
    const prefix = isPrefix ? pathGlob.replace(/\/?\*+$/, '') : pathGlob;
    if (isPrefix) {
      hits = hits.filter((n) => n.path === prefix || n.path.startsWith(prefix + '/'));
    } else {
      hits = hits.filter((n) => n.path === pathGlob);
    }
  }
  if (text) {
    const q = text.toLowerCase();
    hits = hits.filter((n) => n.name && n.name.toLowerCase().includes(q));
  }

  const total = hits.length;
  const paged = hits.slice(cursorNum, cursorNum + limitNum);
  const handles = paged.map((n) => ({ uuid: n.uuid, path: n.path ?? '', name: n.name ?? '', file: n.file ?? '' }));
  const truncated = cursorNum + limitNum < total;
  const nextCursor = truncated ? cursorNum + limitNum : null;

  const age_ms = graph.builtAt ? Date.now() - graph.builtAt : 0;
  const stale = { age_ms, dirty: !!graph.dirty, prefabOpaque: !!graph.prefabOpaque };

  return { total, truncated, cursor: nextCursor, handles, stale };
}
