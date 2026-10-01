import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { buildAll } from './src/builder.mjs';
import { findAssetRefs, loadShard, navigate, queryShard, resolveNode, staleState } from './src/query.mjs';
import { ENGINE_PROFILE, PARSER_VERSION, isStale } from './src/manifest.mjs';
import { assertBundleName, resolveInside } from './src/path-safety.mjs';
import { readJson } from './src/storage.mjs';

if (!parentPort) throw new Error('Graph worker requires a parent.');
const { operation, input } = workerData ?? {};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function contained(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel));
}

function ensureProject(project, outDir) {
  if (typeof project !== 'string' || typeof outDir !== 'string' || !existsSync(project) || !existsSync(outDir)) fail('GRAPH_PATH_INVALID', 'Graph project/cache paths are unavailable.');
  const realProject = realpathSync(project);
  const realCache = realpathSync(outDir);
  if (!statSync(realProject).isDirectory() || !statSync(realCache).isDirectory() || !contained(realProject, realCache) || relative(realProject, realCache) !== join('.cocos-graph', 'cocos-pilot')) fail('GRAPH_PATH_INVALID', 'Graph cache must be the active project .cocos-graph/cocos-pilot namespace.');
  return { project: realProject, outDir: realCache };
}

function readManifest(outDir) {
  const file = join(outDir, '_manifest.json');
  if (!existsSync(file)) return null;
  if (!contained(outDir, realpathSync(file))) fail('GRAPH_PATH_INVALID', 'Graph manifest escapes the cache root.');
  const manifest = readJson(file);
  if (!manifest || !Array.isArray(manifest.shards)) fail('GRAPH_CACHE_CORRUPT', 'Graph manifest is unreadable.');
  return manifest;
}

function verifyShard(outDir, shard) {
  if (typeof shard?.graphFile !== 'string' || !shard.graphFile) fail('GRAPH_CACHE_CORRUPT', 'Graph shard lacks a graph file.');
  let file;
  try { file = resolveInside(outDir, shard.graphFile, 'manifest graphFile'); }
  catch { fail('GRAPH_PATH_INVALID', 'Graph shard path escapes the cache root.'); }
  const parent = join(file, '..');
  if (existsSync(parent) && !contained(outDir, realpathSync(parent))) fail('GRAPH_PATH_INVALID', 'Graph shard directory escapes the cache root.');
  if (existsSync(file) && !contained(outDir, realpathSync(file))) fail('GRAPH_PATH_INVALID', 'Graph shard symlink escapes the cache root.');
}

function summary(outDir, shard) {
  let graphAvailable = false;
  try { verifyShard(outDir, shard); loadShard(outDir, shard.name); graphAvailable = true; } catch {}
  return {
    name: shard.name, source: shard.source ?? 'unknown', files: shard.files ?? 0, bytes: shard.bytes ?? 0,
    builtAt: shard.builtAt ?? null, ageMs: Number.isFinite(shard.builtAt) ? Math.max(0, Date.now() - shard.builtAt) : null,
    dirty: shard.dirty ?? 'unknown', prefabOpaque: shard.prefabOpaque === true, graphAvailable,
  };
}

function ensureBuildSource(project, bundle) {
  const assets = join(project, 'assets');
  if (!existsSync(assets) || !statSync(assets).isDirectory() || !contained(project, realpathSync(assets))) fail('GRAPH_PATH_INVALID', 'Project assets/ path is missing or escapes the project.');
  if (bundle) {
    assertBundleName(bundle);
    const bundlePath = join(assets, bundle);
    if (existsSync(bundlePath) && (!statSync(bundlePath).isDirectory() || !contained(realpathSync(assets), realpathSync(bundlePath)))) fail('GRAPH_PATH_INVALID', 'Bundle path escapes assets/.');
  }
}

function run() {
  const { project, outDir } = ensureProject(input?.project, input?.outDir);
  if (input.refresh !== undefined || input.liveSnapshot !== undefined) fail('GRAPH_PATH_INVALID', 'Automatic refresh and live overlay are unsupported in Creator 2.4.');
  if (input.source !== undefined && input.source !== 'disk') fail('GRAPH_PATH_INVALID', 'Creator 2.4 live/auto graph source is unsupported.');
  const bundle = input?.bundle;
  if (bundle !== undefined && bundle !== null) {
    try { assertBundleName(bundle); } catch { fail('GRAPH_PATH_INVALID', 'Invalid graph bundle name.'); }
  }
  const manifest = readManifest(outDir);
  if (operation === 'status') {
    const shards = manifest?.shards ?? [];
    return {
      cacheRoot: outDir, built: !!manifest, parserVersion: manifest?.parserVersion ?? null,
      supported: manifest?.parserVersion === PARSER_VERSION && manifest?.engineProfile === ENGINE_PROFILE,
      stale: !manifest || isStale(manifest) || manifest.engineProfile !== ENGINE_PROFILE,
      shards: shards.filter((item) => !bundle || item.name === bundle).slice(0, 64).map((item) => summary(outDir, item)),
      totalShards: shards.length,
    };
  }
  if (operation === 'build') {
    ensureBuildSource(project, bundle);
    let result;
    try { result = buildAll({ project, outDir, bundleFilter: bundle ?? null }); }
    catch (error) {
      if (/escapes|linked asset entry|invalid top-level bundle/i.test(error.message)) fail('GRAPH_PATH_INVALID', error.message);
      fail('GRAPH_BUILD_FAILED', error.message);
    }
    return { parserVersion: result.parserVersion, builtAt: result.builtAt, shards: result.shards.filter((item) => !bundle || item.name === bundle).slice(0, 64).map((item) => summary(outDir, item)) };
  }
  if (!bundle) fail('GRAPH_PATH_INVALID', `${operation} requires a bundle.`);
  if (!manifest?.shards?.some((shard) => shard.name === bundle)) fail('GRAPH_NOT_BUILT', `Graph shard for bundle "${bundle}" has not been built.`);
  if (manifest.parserVersion !== PARSER_VERSION || manifest.engineProfile !== ENGINE_PROFILE) fail('GRAPH_SCHEMA_UNSUPPORTED', 'Graph schema or engine profile is incompatible; rebuild explicitly.');
  const shard = manifest.shards.find((item) => item.name === bundle);
  verifyShard(outDir, shard);
  let graph;
  try { graph = loadShard(outDir, bundle); }
  catch (error) { fail('GRAPH_CACHE_CORRUPT', error.message); }
  const query = input.query ?? {};
  if (operation === 'query') return { ...queryShard(graph, query), bundle };
  if (operation === 'resolve') {
    const result = resolveNode(graph, input.locator ?? {});
    return { ...result, bundle, stale: staleState(graph), ...(result.candidates ? { candidates: result.candidates.slice(0, 200), totalCandidates: result.candidates.length, truncated: result.candidates.length > 200 } : {}) };
  }
  if (operation === 'navigate') return { ...navigate(graph, input.navigation ?? {}), bundle };
  if (operation === 'refs') return { ...findAssetRefs(graph, { uuid: input.assetUuid, limit: query.limit, cursor: query.cursor }), bundle };
  if (operation === 'validate') return {
    valid: true, bundle, parserVersion: graph.version, nodes: graph.nodes.length, components: graph.comps.length,
    references: graph.refs.length, prefabOpaque: !!graph.prefabOpaque, source: graph.source, dirty: graph.dirty ?? 'unknown', shard: summary(outDir, shard),
  };
  fail('GRAPH_BUILD_FAILED', `Unsupported graph operation: ${operation}`);
}

try { parentPort.postMessage({ ok: true, result: run() }); }
catch (error) { parentPort.postMessage({ ok: false, code: typeof error?.code === 'string' ? error.code : 'GRAPH_BUILD_FAILED', error: error instanceof Error ? error.message : String(error) }); }
