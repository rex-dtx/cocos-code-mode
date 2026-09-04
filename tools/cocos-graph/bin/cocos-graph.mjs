#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildAll } from '../src/builder.mjs';
import { findAssetRefs, loadShard, navigate, queryShard, resolveNode } from '../src/query.mjs';
import { resolveGraphOutName } from '../src/output-path.mjs';
import { recordVerifiedSession } from '../src/session.mjs';

function usage(exitCode = 0) {
  const message = `cocos-graph — bundle-sharded Cocos structural index (T0+T1 only)

Usage:
  cocos-graph build --project <path> [--bundle <name>] [--live-json <path>] [--isolate]
  cocos-graph query --bundle <name> [--by-component <type>] [--by-script <uuid>] [--component-id <id>] [--path-glob <glob>] [--text <q>] [--explain]
  cocos-graph resolve --bundle <name> (--handle <file#uuid> | --uuid <engine-id>)
  cocos-graph navigate --bundle <name> --handle <file#uuid> --relation ancestors|children|descendants [--depth N]
  cocos-graph refs --bundle <name> --asset-uuid <uuid>
  cocos-graph validate --bundle <name>
  cocos-graph session-record --project <path> --bundle <name> --scene-uuid <uuid> --task <text> --verified [--working-path <path>]
All read commands accept --project, --out, --isolate, --limit, and --cursor where applicable.
A live JSON build must contain {sourceFile:"assets/<bundle>/<scene>.scene", tree:{...}, dirty:boolean}.`;
  (exitCode ? console.error : console.log)(message);
  process.exit(exitCode);
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return !value || value.startsWith('--') ? '' : value;
}
const has = (name) => process.argv.includes(`--${name}`);
const required = (name) => {
  const value = arg(name);
  if (!value) throw new Error(`cocos-graph: --${name} <value> is required`);
  return value;
};

const cmd = process.argv[2];
if (!cmd || has('help') || has('h')) usage(0);
const project = arg('project') ? resolve(arg('project')) : process.env.CC_PROJECT_DIR ? resolve(process.env.CC_PROJECT_DIR) : process.cwd();
const isolate = has('isolate') || process.env.CC_GRAPH_ISOLATE === '1';
const outDir = resolve(project, resolveGraphOutName({ explicitOut: arg('out'), isolate, cwd: process.cwd() }));
const limit = arg('limit') ? Number(arg('limit')) : 50;
const cursor = arg('cursor') ? Number(arg('cursor')) : 0;

try {
  if (cmd === 'build') {
    const bundleFilter = arg('bundle');
    const liveJson = arg('live-json');
    if (liveJson && !bundleFilter) throw new Error('cocos-graph build: --live-json requires --bundle');
    const manifest = buildAll({
      project,
      outDir,
      bundleFilter: bundleFilter || null,
      liveJsonByBundle: liveJson ? { [bundleFilter]: resolve(liveJson) } : null,
    });
    const shards = bundleFilter ? manifest.shards.filter((shard) => shard.name === bundleFilter) : manifest.shards;
    console.log(JSON.stringify({ ok: true, outDir, shards, parserVersion: manifest.parserVersion, builtAt: manifest.builtAt }));
  } else if (cmd === 'query') {
    const bundle = required('bundle');
    console.log(JSON.stringify(queryShard(loadShard(outDir, bundle), {
      byComponent: arg('by-component'),
      byScript: arg('by-script'),
      componentUuid: arg('component-id'),
      pathGlob: arg('path-glob'),
      text: arg('text'),
      explain: has('explain'),
      limit,
      cursor,
    })));
  } else if (cmd === 'resolve') {
    const bundle = required('bundle');
    const handle = arg('handle');
    const uuid = arg('uuid');
    if ((!handle && !uuid) || (handle && uuid)) throw new Error('cocos-graph resolve: pass exactly one of --handle or --uuid');
    const result = resolveNode(loadShard(outDir, bundle), handle ? { handle } : { uuid });
    console.log(JSON.stringify(result));
    if (result.status === 'ambiguous') process.exitCode = 3;
    else if (result.status === 'not_found') process.exitCode = 2;
  } else if (cmd === 'navigate') {
    const bundle = required('bundle');
    console.log(JSON.stringify(navigate(loadShard(outDir, bundle), {
      handle: required('handle'),
      relation: required('relation'),
      depth: arg('depth') ? Number(arg('depth')) : 1,
      limit,
      cursor,
    })));
  } else if (cmd === 'refs') {
    const bundle = required('bundle');
    console.log(JSON.stringify(findAssetRefs(loadShard(outDir, bundle), { uuid: required('asset-uuid'), limit, cursor })));
  } else if (cmd === 'session-record') {
    const artifact = recordVerifiedSession({
      root: arg('session-root') ? resolve(arg('session-root')) : process.cwd(),
      project,
      bundle: required('bundle'),
      sceneUuid: required('scene-uuid'),
      workingPath: arg('working-path'),
      task: required('task'),
      verified: has('verified'),
    });
    console.log(JSON.stringify({ ok: true, artifact }));
  } else if (cmd === 'validate') {
    const bundle = required('bundle');
    const graph = loadShard(outDir, bundle);
    const manifest = existsSync(join(outDir, '_manifest.json')) ? JSON.parse(readFileSync(join(outDir, '_manifest.json'), 'utf8')) : null;
    const shard = manifest?.shards?.find((item) => item.name === bundle) ?? null;
    console.log(JSON.stringify({ ok: true, bundle, nodes: graph.nodes.length, comps: graph.comps.length, refs: graph.refs.length, prefabOpaque: !!graph.prefabOpaque, source: graph.source, dirty: graph.dirty, shard }));
  } else {
    usage(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
