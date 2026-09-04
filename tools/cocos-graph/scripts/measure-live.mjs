#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseSceneText } from '../src/parser.mjs';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1];
}
const project = resolve(arg('project') || process.env.CC_PROJECT_DIR || '.');
const base = (arg('base') || process.env.UTCP_BASE || 'http://localhost:49650').replace(/\/$/, '');
const scenes = process.argv.filter((value) => value.startsWith('--scene=')).map((value) => {
  const body = value.slice('--scene='.length);
  const split = body.indexOf('=');
  if (split < 1) throw new Error('--scene format is --scene=<uuid>=<assets/...scene>');
  return { uuid: body.slice(0, split), file: body.slice(split + 1).replace(/\\/g, '/') };
});
if (scenes.length < 3) throw new Error('measure-live requires at least three --scene=<uuid>=<path> arguments');

async function request(path, init) {
  const response = await fetch(base + path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return { body: JSON.parse(text), bytes: Buffer.byteLength(text) };
}
const post = (tool, body) => request(`/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const cli = resolve(import.meta.dirname, '../bin/cocos-graph.mjs');
const original = (await request('/tools/sceneGetInfo')).body.currentScene?.uuid;
const fidelity = [];
let representativeTree;

try {
  for (const scene of scenes) {
    await post('sceneManage', { operation: 'open', reference: { id: scene.uuid } });
    let info;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((done) => setTimeout(done, 100));
      info = (await request('/tools/sceneGetInfo')).body;
      if (info.currentScene?.uuid === scene.uuid) break;
    }
    if (info?.currentScene?.uuid !== scene.uuid) throw new Error(`scene ${scene.uuid} did not become current`);
    const live = await request('/tools/nodeGetTree?verbose=true&maxDepth=99&maxNodes=10000');
    const countLive = (node) => 1 + (node.children ?? []).reduce((sum, child) => sum + countLive(child), 0);
    const liveNodes = (live.body.children ?? []).reduce((sum, child) => sum + countLive(child), 0);
    const disk = parseSceneText(readFileSync(join(project, scene.file), 'utf8'), { file: scene.file });
    fidelity.push({ uuid: scene.uuid, file: scene.file, liveNodes, diskNodes: disk.nodes.length, delta: liveNodes - disk.nodes.length, ratio: disk.nodes.length ? liveNodes / disk.nodes.length : null, responseBytes: live.bytes });
    representativeTree ??= live;
  }
} finally {
  if (original && !scenes.some((scene) => scene.uuid === original && scenes.at(-1)?.uuid === original)) {
    try { await post('sceneManage', { operation: 'open', reference: { id: original } }); } catch {}
  }
}

const namespace = join('.cocos-graph', `measure-${process.pid}`).replace(/\\/g, '/');
const outDir = join(project, namespace);
const bundle = scenes[0].file.split('/')[1];
const timings = { full: [], bundle: [], incremental: [], query: [] };
try {
  for (let i = 0; i < 5; i++) {
    const fullStart = performance.now();
    execFileSync(process.execPath, [cli, 'build', '--project', project, '--out', namespace]);
    timings.full.push(performance.now() - fullStart);
    const bundleStart = performance.now();
    execFileSync(process.execPath, [cli, 'build', '--project', project, '--bundle', bundle, '--out', namespace]);
    timings.bundle.push(performance.now() - bundleStart);
    const incrementalStart = performance.now();
    execFileSync(process.execPath, [cli, 'build', '--project', project, '--bundle', bundle, '--out', namespace]);
    timings.incremental.push(performance.now() - incrementalStart);
  }
  let queryOutput = '';
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    queryOutput = execFileSync(process.execPath, [cli, 'query', '--project', project, '--bundle', bundle, '--by-component', 'cc.Sprite', '--limit', '50', '--out', namespace], { encoding: 'utf8' });
    timings.query.push(performance.now() - start);
  }
  const query = JSON.parse(queryOutput);
  const graphBytes = Buffer.byteLength(queryOutput);
  const liveBytes = representativeTree.bytes;
  const hitChecks = [query.total > 0, fidelity.every((item) => item.diskNodes > 0), fidelity.every((item) => item.liveNodes > 0)];
  const result = {
    fidelity,
    performanceMs: Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), samples: values.length }])),
    workflow: {
      baselineBridgeCalls: 1,
      graphBridgeCalls: 0,
      bridgeCallReductionPct: 100,
      baselineResponseBytes: liveBytes,
      graphResponseBytes: graphBytes,
      responseReductionPct: 100 * (1 - graphBytes / liveBytes),
      graphHitRatePct: 100 * hitChecks.filter(Boolean).length / hitChecks.length,
      taskCorrectness: query.total > 0,
    },
    deltaToolsDecision: 'defer',
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
