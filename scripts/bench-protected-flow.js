#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'reports', 'evidence', 'phase-05', 'one-rtt.json');

function discoverUtcp() {
  if (process.env.CCB_UTCP_URL) return process.env.CCB_UTCP_URL.replace(/\/utcp$/, '');
  const configPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), '.utcp_config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const template = (config.manual_call_templates || []).find((item) => /^ccb3x(?:_\d+)?$/.test(item.name));
  if (!template) throw new Error(`No live ccb3x manual in ${configPath}`);
  return String(template.url).replace(/\/utcp$/, '');
}

async function get(url) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: String((error && error.cause && error.cause.code) || error.message) };
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function main() {
  const base = discoverUtcp();
  const gatewayHealth = process.env.CCB_GATEWAY_HEALTH || 'http://127.0.0.1:8787/ccb/v1/health';
  const [build, manual, health] = await Promise.all([
    get(`${base}/build-info`),
    get(`${base}/utcp`),
    get(gatewayHealth),
  ]);
  let tools = [];
  try { tools = JSON.parse(manual.text).tools || []; } catch { /* not a manual */ }
  const hasExec = tools.some((tool) => tool.name === 'executeJavascript');
  const report = {
    schemaVersion: 1,
    at: new Date().toISOString(),
    utcp: { url: base, buildOk: build.ok, build: build.text.slice(0, 240), toolCount: tools.length, executeJavascript: hasExec },
    gateway: { url: gatewayHealth, ok: health.ok, body: health.text.slice(0, 240) },
    ready: Boolean(build.ok && manual.ok && !hasExec && health.ok),
    samples: [],
    note: 'Live one-RTT proof requires this relay in Creator. Simulated Gateway bench is not this report.',
  };
  if (!report.ready) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    throw new Error('live Creator 3x UTCP is not ready');
  }
  const samples = Number(process.env.CCB_BENCH_SAMPLES || '20');
  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    const response = await fetch(`${base}/tools/sceneGetInfo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error',
    });
    const text = await response.text();
    durations.push(performance.now() - started);
    if (!response.ok) throw new Error(`sceneGetInfo -> ${response.status}: ${text.slice(0, 200)}`);
  }
  report.samples = {
    count: durations.length,
    medianMs: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
  };
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
