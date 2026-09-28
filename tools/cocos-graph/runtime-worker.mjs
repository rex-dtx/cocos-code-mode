import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { readJson } from './src/storage.mjs';
import { buildAll } from './src/builder.mjs';
import { findAssetRefs, loadShard, navigate, queryShard, resolveNode, staleState } from './src/query.mjs';
import { PARSER_VERSION, isStale } from './src/manifest.mjs';
import { resolveInside, assertBundleName } from './src/path-safety.mjs';

if (!parentPort) throw new Error('cocos-graph runtime worker requires a worker_threads parent');

const { operation, input } = workerData ?? {};

function readManifest(outDir) {
  const manifest = readJson(join(outDir, '_manifest.json'));
  return manifest && Array.isArray(manifest.shards) ? manifest : null;
}

function shardSummary(outDir, shard) {
  let graphAvailable = false;
  try {
    const graph = readJson(resolveInside(outDir, shard.graphFile, 'manifest graphFile'));
    graphAvailable = !!graph && graph.version === PARSER_VERSION && graph.bundle === shard.name;
  } catch {}
  return {
    name: shard.name,
    source: shard.source ?? 'unknown',
    files: Number.isInteger(shard.files) ? shard.files : 0,
    bytes: Number.isFinite(shard.bytes) ? shard.bytes : 0,
    builtAt: Number.isFinite(shard.builtAt) ? shard.builtAt : null,
    ageMs: Number.isFinite(shard.builtAt) ? Math.max(0, Date.now() - shard.builtAt) : null,
    dirty: shard.dirty ?? 'unknown',
    prefabOpaque: shard.prefabOpaque === true,
    graphAvailable,
  };
}

function publishBuild({ project, outDir, bundle, source, liveSnapshot }) {
  let liveJsonPath = null;
  try {
    if (source === 'auto' && liveSnapshot) {
      if (!bundle) throw new Error('cocos-graph: auto source requires one resolved active-scene bundle');
      liveJsonPath = join(outDir, `.live-${process.pid}-${randomBytes(8).toString('hex')}.json`);
      writeFileSync(liveJsonPath, JSON.stringify(liveSnapshot), { flag: 'wx' });
    }
    return buildAll({
      project,
      outDir,
      bundleFilter: bundle ?? null,
      liveJsonByBundle: liveJsonPath && bundle ? { [bundle]: liveJsonPath } : null,
    });
  } finally {
    if (liveJsonPath) {
      try { unlinkSync(liveJsonPath); } catch {}
    }
  }
}

function verifyShardPath(outDir, shard) {
  if (!shard?.graphFile) throw new Error(`cocos-graph: shard "${shard?.name ?? ''}" is corrupt (missing graph path)`);
  resolveInside(outDir, shard.graphFile, 'manifest graphFile');
}

async function run() {
  const { project, outDir, bundle, refresh = false, source = 'disk', liveSnapshot = null, query = {}, locator = {}, navigation = {}, assetUuid = null } = input ?? {};
  if (operation === 'status') {
    const manifest = readManifest(outDir);
    const candidates = manifest?.shards ?? [];
    return {
      cacheRoot: outDir,
      built: !!manifest,
      parserVersion: manifest?.parserVersion ?? null,
      supported: manifest?.parserVersion === PARSER_VERSION,
      stale: !manifest || isStale(manifest),
      shards: candidates.filter((item) => !bundle || item.name === bundle).slice(0, 64).map((item) => shardSummary(outDir, item)),
      totalShards: candidates.length,
    };
  }

  if (operation === 'build') {
    if (!['disk', 'auto'].includes(source)) throw new Error('cocos-graph: source must be disk or auto');
    const manifest = publishBuild({ project, outDir, bundle, source, liveSnapshot });
    return {
      parserVersion: manifest.parserVersion,
      builtAt: manifest.builtAt,
      shards: manifest.shards.filter((item) => !bundle || item.name === bundle).slice(0, 64).map((item) => shardSummary(outDir, item)),
    };
  }

  if (!bundle) throw new Error(`cocos-graph: ${operation} requires a bundle`);
  assertBundleName(bundle);
  let manifest = readManifest(outDir);
  let shard = manifest?.shards?.find((item) => item.name === bundle);
  const stale = !manifest || manifest.parserVersion !== PARSER_VERSION || isStale(manifest) || !!shard?.dirty || !!shard?.prefabOpaque;
  if (refresh && stale) {
    manifest = publishBuild({ project, outDir, bundle, source: 'disk', liveSnapshot: null });
    shard = manifest.shards.find((item) => item.name === bundle);
  }
  if (!shard || !manifest) {
    const error = new Error(`cocos-graph: shard not built for bundle "${bundle}" (run graphManage build for this bundle)`);
    error.code = 'GRAPH_NOT_BUILT';
    throw error;
  }
  verifyShardPath(outDir, shard);
  const graph = loadShard(outDir, bundle);
  if (operation === 'query') {
    const result = queryShard(graph, query);
    return { ...result, bundle, stale: { ...result.stale, advisory: stale || result.stale.advisory } };
  }
  if (operation === 'resolve') return { ...resolveNode(graph, locator), bundle, stale: staleState(graph) };
  if (operation === 'navigate') return { ...navigate(graph, navigation), bundle };
  if (operation === 'refs') return { ...findAssetRefs(graph, { ...query, uuid: assetUuid }), bundle };
  if (operation === 'validate') {
    return {
      valid: true,
      bundle,
      parserVersion: graph.version,
      nodes: graph.nodes.length,
      components: graph.comps.length,
      references: graph.refs.length,
      prefabOpaque: graph.prefabOpaque === true,
      source: graph.source,
      dirty: graph.dirty ?? 'unknown',
      shard: shardSummary(outDir, shard),
    };
  }
  throw new Error(`cocos-graph: unsupported operation "${operation}"`);
}

try {
  const result = await run();
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, code: typeof error?.code === 'string' ? error.code : 'GRAPH_BUILD_FAILED', error: error instanceof Error ? error.message : String(error) });
}
