#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAll } from '../src/builder.mjs';
import { loadShard, queryShard } from '../src/query.mjs';

function usage(exitCode = 0) {
  const msg = `cocos-graph — shard-per-bundle scene index (T0+T1, no T2)

Usage:
  cocos-graph build  --project <path> [--bundle <name>] [--live-json <path>] [--out .cocos-graph]
  cocos-graph query  --bundle <name> [--by-component <type>] [--by-script <uuid>] [--path-glob <glob>] [--text <q>] [--limit N] [--cursor N] [--project <path>] [--out .cocos-graph]
  cocos-graph validate --bundle <name> [--project <path>] [--out .cocos-graph]

Build: parses assets/<bundle>/**/*.scene|.prefab. When --live-json is supplied,
  that shard is live-sourced (the open scene's nodeGetTree verbose JSON) and
  marked source:live (includes prefab expansion; disk shards are prefabOpaque
  when needed). Plain JSON + Maps, no SQLite (D9).

Query: handle-first {total,truncated,cursor,handles:[{uuid,path,name,file}],stale:{age_ms,dirty,prefabOpaque}}.
  At most one filter; multiple filters are AND. Exit 2 = shard not built/stale; exit 0 = 0 matches ok.

Examples:
  cocos-graph build  --project G:/_ws/cc-fws/cc30-new-all-in-one
  cocos-graph query  --bundle cc-release-slot --by-component cc.Sprite --limit 20
`;
  if (exitCode === 0) console.log(msg);
  else console.error(msg);
  process.exit(exitCode);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return '';
  return v;
}
function has(name) { return process.argv.includes(`--${name}`); }

const cmd = process.argv[2];
if (!cmd || has('help') || has('h')) usage(0);

const project = arg('project') ? resolve(arg('project')) : (process.env.CC_PROJECT_DIR ? resolve(process.env.CC_PROJECT_DIR) : process.cwd());
const outRelative = arg('out') ?? '.cocos-graph';
const outDir = resolve(project, outRelative);

if (cmd === 'build') {
  const bundleFilter = arg('bundle');
  const liveJson = arg('live-json');
  const liveByBundle = liveJson && bundleFilter ? { [bundleFilter]: resolve(liveJson) } : null;
  try {
    const manifest = buildAll({ project, outDir, liveJsonByBundle: liveByBundle });
    const built = bundleFilter ? manifest.shards.filter((s) => s.name === bundleFilter) : manifest.shards;
    console.log(JSON.stringify({ ok: true, outDir, shards: built, parserVersion: manifest.parserVersion ?? '3', builtAt: manifest.builtAt }));
  } catch (err) {
    console.error(`cocos-graph build: ${err.message}`);
    process.exit(2);
  }
} else if (cmd === 'query') {
  const bundle = arg('bundle');
  if (!bundle) { console.error('cocos-graph query: --bundle <name> is required'); process.exit(2); }
  const limit = arg('limit') ? Number(arg('limit')) : 50;
  const cursor = arg('cursor') ? Number(arg('cursor')) : 0;
  try {
    const graph = loadShard(outDir, bundle);
    const res = queryShard(graph, {
      byComponent: arg('by-component'),
      byScript: arg('by-script'),
      pathGlob: arg('path-glob'),
      text: arg('text'),
      limit,
      cursor,
    });
    console.log(JSON.stringify(res));
  } catch (err) {
    console.error(err.message);
    process.exit(err.message.includes('stale or unreadable') ? 2 : 2);
  }
} else if (cmd === 'validate') {
  const bundle = arg('bundle');
  if (!bundle) { console.error('cocos-graph validate: --bundle <name> is required'); process.exit(2); }
  try {
    const graph = loadShard(outDir, bundle);
    const manifest = existsSync(join(outDir, '_manifest.json')) ? JSON.parse(readFileSync(join(outDir, '_manifest.json'), 'utf8')) : null;
    const stale = manifest ? manifest.shards.find((s) => s.name === bundle) : null;
    console.log(JSON.stringify({ ok: true, bundle, nodes: graph.nodes.length, comps: graph.comps.length, prefabOpaque: !!graph.prefabOpaque, source: graph.source ?? 'disk', stale }));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
} else {
  console.error(`Unknown command: ${cmd}`);
  usage(2);
}
