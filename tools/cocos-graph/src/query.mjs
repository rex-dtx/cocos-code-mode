import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertBundleName, resolveInside } from './path-safety.mjs';
import { PARSER_VERSION } from './manifest.mjs';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`cocos-graph: unreadable JSON ${path} (${error.message})`); }
}

export function loadShard(outDir, bundle) {
  assertBundleName(bundle);
  const manifestPath = join(outDir, '_manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`cocos-graph: shard not built for bundle "${bundle}" (run: cocos-graph build ...)`);
  const manifest = readJson(manifestPath);
  if (manifest.parserVersion !== PARSER_VERSION) {
    throw new Error(`cocos-graph: parserVersion "${manifest.parserVersion ?? 'missing'}" is stale; version "${PARSER_VERSION}" required (run: cocos-graph build ...)`);
  }
  const record = manifest.shards?.find((shard) => shard.name === bundle);
  if (!record?.graphFile) throw new Error(`cocos-graph: shard not built for bundle "${bundle}" (run: cocos-graph build ...)`);
  const graph = readJson(resolveInside(outDir, record.graphFile, 'manifest graphFile'));
  const { builtAt: _builtAt, manifestBuiltAt: _manifestBuiltAt, ...stable } = graph;
  const actualHash = createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
  if (graph.version !== PARSER_VERSION || graph.bundle !== bundle || record.sha256 !== actualHash) {
    throw new Error(`cocos-graph: shard ${bundle} is stale or unreadable (parserVersion "${PARSER_VERSION}" expected, run build)`);
  }
  graph.manifestBuiltAt = manifest.builtAt;
  return graph;
}

export function buildMaps(graph) {
  const byType = new Map();
  const byUuid = new Map();
  const byHandle = new Map();
  const byScript = new Map();
  const children = new Map();
  const componentByUuid = new Map();
  for (const node of graph.nodes ?? []) {
    byHandle.set(node.handle, node);
    if (!byUuid.has(node.uuid)) byUuid.set(node.uuid, []);
    byUuid.get(node.uuid).push(node);
    if (node.parent) {
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(node);
    }
  }
  for (const component of graph.comps ?? []) {
    if (!byType.has(component.type)) byType.set(component.type, []);
    byType.get(component.type).push(component);
    if (component.script) {
      if (!byScript.has(component.script)) byScript.set(component.script, []);
      byScript.get(component.script).push(component);
    }
    if (component.uuid) {
      if (!componentByUuid.has(component.uuid)) componentByUuid.set(component.uuid, []);
      componentByUuid.get(component.uuid).push(component);
    }
  }
  return { byType, byUuid, byHandle, byScript, children, componentByUuid };
}

export function nodeHandle(node, graph, reason) {
  return {
    handle: node.handle,
    uuid: node.uuid,
    path: node.path ?? '',
    name: node.name ?? '',
    file: node.file,
    source: node.source ?? 'disk',
    bundle: graph.bundle,
    ...(reason ? { reason } : {}),
  };
}

function page(nodes, graph, { limit = 50, cursor = 0, reason } = {}) {
  const limitNum = Math.max(1, Math.min(Number(limit) || 50, 200));
  const cursorNum = Math.max(0, Number(cursor) || 0);
  const ordered = [...nodes].sort((a, b) => a.handle.localeCompare(b.handle));
  const handles = ordered.slice(cursorNum, cursorNum + limitNum).map((node) => nodeHandle(node, graph, reason));
  const next = cursorNum + limitNum < ordered.length ? cursorNum + limitNum : null;
  return { total: ordered.length, truncated: next !== null, cursor: next, handles };
}

export function queryShard(graph, { byComponent, byScript, componentUuid, pathGlob, text, limit = 50, cursor = 0, explain = false } = {}) {
  const maps = buildMaps(graph);
  let hits = [...(graph.nodes ?? [])];
  const reasons = [];
  if (byComponent) {
    const handles = new Set((maps.byType.get(byComponent) ?? []).map((component) => component.node));
    hits = hits.filter((node) => handles.has(node.handle));
    reasons.push(`component:${byComponent}`);
  }
  if (byScript) {
    const handles = new Set((maps.byScript.get(byScript) ?? []).map((component) => component.node));
    hits = hits.filter((node) => handles.has(node.handle));
    reasons.push(`script:${byScript}`);
  }
  if (componentUuid) {
    const handles = new Set((maps.componentByUuid.get(componentUuid) ?? []).map((component) => component.node));
    hits = hits.filter((node) => handles.has(node.handle));
    reasons.push(`componentUuid:${componentUuid}`);
  }
  if (pathGlob) {
    const prefixMode = pathGlob.endsWith('/*') || pathGlob.endsWith('/**');
    const prefix = prefixMode ? pathGlob.replace(/\/?\*+$/, '') : pathGlob;
    hits = hits.filter((node) => prefixMode ? node.path === prefix || node.path.startsWith(`${prefix}/`) : node.path === pathGlob);
    reasons.push(`path:${pathGlob}`);
  }
  if (text) {
    const needle = text.toLowerCase();
    hits = hits.filter((node) => node.name?.toLowerCase().includes(needle));
    reasons.push(`text:${text}`);
  }
  const result = page(hits, graph, { limit, cursor, reason: explain ? reasons.join(' AND ') || 'all nodes' : null });
  return { ...result, stale: staleState(graph) };
}

export function resolveNode(graph, locator) {
  const maps = buildMaps(graph);
  if (locator.handle) {
    const node = maps.byHandle.get(locator.handle);
    if (!node) return { status: 'not_found', candidates: [] };
    return { status: 'resolved', node: nodeHandle(node, graph, 'exact composite handle') };
  }
  const candidates = maps.byUuid.get(locator.uuid) ?? [];
  if (candidates.length === 1) return { status: 'resolved', node: nodeHandle(candidates[0], graph, 'unique engine UUID') };
  return { status: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.map((node) => nodeHandle(node, graph, 'same file-local engine UUID')) };
}

export function navigate(graph, { handle, relation, depth = 1, limit = 50, cursor = 0 }) {
  const maps = buildMaps(graph);
  const start = maps.byHandle.get(handle);
  if (!start) return { ...page([], graph, { limit, cursor }), relation, stale: staleState(graph) };
  const maxDepth = Math.max(1, Math.min(Number(depth) || 1, 32));
  const found = [];
  if (relation === 'ancestors') {
    let current = start;
    for (let i = 0; i < maxDepth && current.parent; i++) {
      current = maps.byHandle.get(current.parent);
      if (!current) break;
      found.push(current);
    }
  } else if (relation === 'children') {
    found.push(...(maps.children.get(handle) ?? []));
  } else if (relation === 'descendants') {
    const queue = (maps.children.get(handle) ?? []).map((node) => ({ node, depth: 1 }));
    while (queue.length) {
      const item = queue.shift();
      found.push(item.node);
      if (item.depth < maxDepth) for (const child of maps.children.get(item.node.handle) ?? []) queue.push({ node: child, depth: item.depth + 1 });
    }
  } else throw new Error(`cocos-graph: unknown relation "${relation}"`);
  return { ...page(found, graph, { limit, cursor, reason: `${relation} of ${handle}` }), relation, stale: staleState(graph) };
}

export function findAssetRefs(graph, { uuid, limit = 50, cursor = 0 }) {
  const matching = (graph.refs ?? []).filter((ref) => ref.uuid === uuid).sort((a, b) => `${a.node}:${a.prop}`.localeCompare(`${b.node}:${b.prop}`));
  const limitNum = Math.max(1, Math.min(Number(limit) || 50, 200));
  const cursorNum = Math.max(0, Number(cursor) || 0);
  const refs = matching.slice(cursorNum, cursorNum + limitNum).map((ref) => ({ ...ref, bundle: graph.bundle }));
  const next = cursorNum + limitNum < matching.length ? cursorNum + limitNum : null;
  return { total: matching.length, truncated: next !== null, cursor: next, refs, stale: staleState(graph) };
}

export function staleState(graph) {
  return {
    age_ms: Date.now() - (graph.builtAt || graph.manifestBuiltAt || Date.now()),
    dirty: graph.dirty ?? 'unknown',
    advisory: graph.dirty !== false || !!graph.prefabOpaque,
    prefabOpaque: !!graph.prefabOpaque,
  };
}
