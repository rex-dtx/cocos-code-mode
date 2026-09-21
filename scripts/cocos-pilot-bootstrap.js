#!/usr/bin/env node
// cocos-pilot-bootstrap — SessionStart hook: fetch live cocos-pilot manuals from
// ~/.utcp_config.json and cache tool metadata to .claude/cocos-pilot-cache.json.
// It never registers manuals in the Code Mode MCP process; agents do that per session.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const CANON_3X = 'ccp3x';
const CANON_2X = 'ccp2x';
const PERPORT_3X = /^ccp3x_\d+$/;
const PERPORT_2X = /^ccp2x_\d+$/;

// Max age before a cached entry that has not been re-probed live is marked stale.
// Mirrors runbook §3 readiness: age_ms = now - fetchedAt; is_stale = age_ms > threshold.
// Threshold env-overridable for tests. 24h matches plan P0 "without successful probe".
const STALE_AFTER_MS = Number(process.env.COCOS_PILOT_CACHE_MAX_AGE_MS) || 24 * 60 * 60 * 1000;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function fetchJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let req;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(value);
    };
    // An absolute deadline also bounds connect time and trickling response bodies.
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      req = http.get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) { finish(null); return; }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('error', () => finish(null));
        res.on('aborted', () => finish(null));
        res.on('end', () => { try { finish(JSON.parse(body)); } catch { finish(null); } });
      });
      req.on('error', () => finish(null));
    } catch { finish(null); }
  });
}

function is3x(m) { return m?.name === CANON_3X || PERPORT_3X.test(m?.name); }
function is2x(m) { return m?.name === CANON_2X || PERPORT_2X.test(m?.name); }

function endpoint3x(m) {
  if (!is3x(m)) return null;
  try {
    const url = new URL(m.url);
    if (url.protocol !== 'http:' || !/^\/utcp\/?$/.test(url.pathname)
      || url.username || url.password || url.search || url.hash) return null;
    const port = Number(url.port || 80);
    const name = `ccp3x_${port}`;
    if (port < 1 || (m.name !== CANON_3X && m.name !== name)) return null;
    url.pathname = '/utcp';
    const normalizedUrl = url.href;
    // The server binds IPv4 loopback; these two spellings identify one endpoint.
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost';
    return { name, url: normalizedUrl, identity: url.href };
  } catch { return null; }
}

/**
 * Liveness gate. A probe is LIVE only when ALL hold:
 *  - fetch succeeded (manual is a parsed object with an array tools field)
 *  - toolCount > 0
 *  - provenance present: manual_version/utcp_version OR buildInfo
 * Otherwise the editor is considered dead for this manual — its 0 must never
 * be written as authoritative.
 */
function isLiveProbe(manual, buildInfo, toolCount) {
  if (manual == null) return false;
  if (!Array.isArray(manual.tools)) return false;
  if (toolCount <= 0) return false;
  const hasManualVersion = !!(manual.manual_version || manual.utcp_version);
  const hasBuildInfo = buildInfo != null;
  if (!hasManualVersion && !hasBuildInfo) return false;
  return true;
}

function computeAgeMs(fetchedAt, nowMs) {
  if (!fetchedAt) return null;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, nowMs - t);
}

function cacheKeyFor(m) {
  if (is3x(m)) return endpoint3x(m)?.name || null;
  return PERPORT_2X.test(m.name) ? m.name : CANON_2X;
}

/**
 * Pure core: merge prior disk cache with this run's probes.
 * - Per-endpoint independence: legacy ccp3x aliases migrate to their actual port.
 * - Live probe → write authoritative entry with fetchedAt/age_ms:0.
 * - Dead probe + prior authoritative entry → retain prior, update age_ms + stale marker, never clobber count.
 * - Dead probe + no prior → tombstone (authoritative:false), never an authoritative 0 entry.
 * - Prior keys not probed this run are retained with age_ms refresh + max-age stale mark.
 * Exported for unit tests (inject fetchJson/now).
 */
async function buildCache({ utcpConfig, priorCache, fetchJson: doFetch, now }) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const priorManuals = {};
  const priorRanks = new Map();
  const conflictingPrior = new Set();
  for (const [name, entry] of Object.entries(priorCache?.manuals || {})) {
    if (!is3x({ name })) { priorManuals[name] = entry; continue; }
    const endpoint = endpoint3x({ name, url: entry.url });
    if (!endpoint) continue;
    const existing = priorManuals[endpoint.name];
    if (existing && endpoint3x({ name: endpoint.name, url: existing.url }).identity !== endpoint.identity) {
      conflictingPrior.add(endpoint.name);
      continue;
    }
    const rank = name === endpoint.name ? 1 : 0;
    if (!existing || rank > priorRanks.get(endpoint.name)) {
      const { aliasOf, ...retained } = entry;
      priorManuals[endpoint.name] = { ...retained, url: endpoint.url };
      priorRanks.set(endpoint.name, rank);
    }
  }
  for (const name of conflictingPrior) delete priorManuals[name];

  const manualsIn = Array.isArray(utcpConfig?.manual_call_templates)
    ? utcpConfig.manual_call_templates.filter((m) => is3x(m) || is2x(m)) : [];
  const byEndpoint = new Map();
  const endpointsByName = new Map();
  const conflicts = new Set();
  for (const m of manualsIn) {
    const endpoint = is3x(m) ? endpoint3x(m) : null;
    if (is3x(m) && !endpoint) continue;
    const base = (endpoint?.url || m.url || '').replace(/\/utcp\/?$/, '');
    if (!base) continue;
    const identity = endpoint?.identity || base;
    const name = endpoint?.name || cacheKeyFor(m);
    if (endpoint && endpointsByName.has(name) && endpointsByName.get(name) !== identity) conflicts.add(name);
    endpointsByName.set(name, identity);
    const key = `${is3x(m) ? '3x' : '2x'}:${identity}`;
    const existing = byEndpoint.get(key);
    const preferred = endpoint ? m.name === name : m.name === CANON_2X;
    if (!existing || preferred) byEndpoint.set(key, { name, url: endpoint?.url || m.url, base });
  }
  const selectedNames = new Set();
  const selected = [...byEndpoint.values()].filter((m) => {
    if (conflicts.has(m.name) || selectedNames.has(m.name)) return false;
    selectedNames.add(m.name);
    return true;
  });
  // Leave time for cache publication inside the 10-second SessionStart hook.
  const deadline = Date.now() + 8000;
  const probe = async (url) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    try { return await doFetch(url, Math.min(2500, remaining)); } catch { return null; }
  };
  const nextManuals = {};
  const probeManual = async (m) => {
    const cKey = m.name;
    const base = m.base;
    const [manual, buildInfo] = await Promise.all([probe(`${base}/utcp`), probe(`${base}/build-info`)]);
    const toolDefs = manual && Array.isArray(manual.tools) ? manual.tools : [];
    const tools = toolDefs.map((t) => t.name);
    const live = isLiveProbe(manual, buildInfo, toolDefs.length);
    let handshake = { status: 'unavailable', checkedAt: nowIso, result: null };
    if (live && tools.includes('editorHandshake')) {
      const response = await probe(`${base}/tools/editorHandshake?timeoutMs=1000`);
      // Envelope mode is optional on the server. Never infer readiness from HTTP 200 alone.
      const result = response?.probe ? response : response?.ok === true && response?.tool === 'editorHandshake' ? response.data : null;
      const valid = result && typeof result.instanceId === 'string'
        && ['responsive', 'timeout', 'error', 'invalid-response'].includes(result.probe?.status)
        && (result.probe.status !== 'responsive' || typeof result.probe.sceneReady === 'boolean');
      handshake = { status: valid ? result.probe.status : 'unverified', checkedAt: nowIso, result: valid ? result : null };
    } else if (live) {
      handshake.status = 'unsupported';
    }

    const cached = priorManuals[cKey];
    const prior = !is3x(m) || (cached && endpoint3x({ name: cKey, url: cached.url })?.identity === endpoint3x(m)?.identity)
      ? cached : null;

    if (live) {
      nextManuals[cKey] = {
        url: m.url,
        toolCount: toolDefs.length,
        tools,
        toolDefs,
        buildInfo: buildInfo || null,
        handshake,
        fetchedAt: nowIso,
        age_ms: 0,
        live: true,
        authoritative: true,
        stale: false,
      };
    } else {
      // Dead probe — never create an authoritative 0 entry.
      if (prior && prior.toolCount > 0 && prior.authoritative !== false) {
        // Retain good prior; update staleness markers.
        const ageMs = computeAgeMs(prior.fetchedAt || prior.updatedAt || priorCache.updatedAt, nowMs);
        const overMaxAge = ageMs != null && ageMs > STALE_AFTER_MS;
        const ageOut = ageMs != null ? ageMs : null;
        nextManuals[cKey] = {
          ...prior,
          age_ms: ageOut != null ? ageOut : prior.age_ms ?? null,
          handshake,
          live: false,
          stale: true,
          staleReason: overMaxAge ? 'max_age' : 'probe_failed',
        };
      } else if (prior && prior.authoritative === false) {
        // Prior was already a tombstone — keep it, refresh age, stay stale.
        const ageMs = computeAgeMs(prior.fetchedAt, nowMs);
        nextManuals[cKey] = {
          ...prior,
          handshake,
          age_ms: ageMs != null ? ageMs : prior.age_ms ?? 0,
          live: false,
          stale: true,
          staleReason: 'probe_failed',
        };
      } else {
        // First-run dead fetch (no good prior): do NOT create an authoritative 0.
        // Write a non-authoritative tombstone so the run is diagnosable but never
        // counted as "ready". Skipping the write entirely would also satisfy the
        // acceptance rule, but a tombstone makes the dead state explicit to the
        // skill and to the log line instead of looking like a missing manual.
        nextManuals[cKey] = {
          url: m.url,
          toolCount: 0,
          tools: [],
          toolDefs: [],
          buildInfo: buildInfo || null,
          handshake,
          fetchedAt: nowIso,
          age_ms: 0,
          live: false,
          authoritative: false,
          stale: true,
          staleReason: 'probe_failed',
        };
      }
    }
  };
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (nextIndex < selected.length) await probeManual(selected[nextIndex++]);
  }));

  // Retain prior keys that were not probed this run (e.g. a generation absent from
  // utcp_config this session). Their age keeps ticking and max-age still marks them.
  for (const [k, v] of Object.entries(priorManuals)) {
    if (nextManuals[k] !== undefined) continue;
    const ageMs = computeAgeMs(v.fetchedAt || v.updatedAt || priorCache.updatedAt, nowMs);
    const retained = { ...v, handshake: { status: 'unverified', checkedAt: null, result: null } };
    if (is3x({ name: k })) {
      retained.live = false;
      retained.stale = true;
      retained.staleReason = conflicts.has(k) ? 'ambiguous_endpoint' : 'not_probed';
    }
    if (ageMs != null && ageMs > STALE_AFTER_MS) {
      nextManuals[k] = { ...retained, age_ms: ageMs, stale: true, staleReason: 'max_age', live: false };
    } else if (ageMs != null) {
      // Keep as-is but keep age_ms fresh so readers can run age_ms = now - fetchedAt.
      nextManuals[k] = { ...retained, age_ms: ageMs };
    } else {
      nextManuals[k] = retained;
    }
  }

  return { updatedAt: nowIso, manuals: nextManuals };
}

async function main() {
  const home = os.homedir();
  const utcpPath = path.join(home, '.utcp_config.json');
  const utcp = readJson(utcpPath);
  const manuals = Array.isArray(utcp?.manual_call_templates)
    ? utcp.manual_call_templates.filter((m) => is3x(m) || is2x(m)) : [];

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');
  const cachePath = path.join(claudeDir, 'cocos-pilot-cache.json');
  const priorCache = readJson(cachePath);
  if (manuals.length === 0 && !priorCache) return;
  const now = new Date();

  const cache = await buildCache({ utcpConfig: utcp, priorCache, fetchJson, now });

  try {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch {}

  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && fs.existsSync(path.dirname(envFile))) {
    try { fs.appendFileSync(envFile, `CK_CODE_MODE=ready\n`); } catch {}
    for (const [name, info] of Object.entries(cache.manuals)) {
      try { fs.appendFileSync(envFile, `CK_CODE_MODE_${name.toUpperCase().replace(/-/g, '_')}=${info.toolCount}\n`); } catch {}
    }
  }

  const names = Object.keys(cache.manuals).join(', ');
  const liveTotal = Object.values(cache.manuals)
    .filter((v) => v.authoritative !== false && v.live !== false)
    .reduce((s, v) => s + (v.toolCount || 0), 0);
  const staleNote = Object.values(cache.manuals).some((v) => v.stale) ? ' (stale)' : '';
  console.log(`[cocos-pilot-bootstrap] cached ${names} (${liveTotal} live tools) → .claude/cocos-pilot-cache.json${staleNote}`);
  for (const [name, info] of Object.entries(cache.manuals)) {
    if (info.handshake?.status === 'unsupported') {
      console.log(`[cocos-pilot-bootstrap] ${name}: editorHandshake not advertised by this build; discovery is not IPC readiness. Update Cocos Pilot to use handshake.`);
    } else {
      console.log(`[cocos-pilot-bootstrap] ${name}: editorHandshake HTTP probe=${info.handshake?.status ?? 'unverified'}. Select one namespace and endpoint (${info.url}), then register_manual + list_tools and call ${name}.editorHandshake({timeoutMs:1000, expectedProjectPath:"<absolute Creator project path>"}) through call_tool_chain. Bind namespace + endpoint + projectPath + instanceId. Require projectMatches:true and a responsive probe before mutations; sceneReady:false means connected but scene not ready. Re-handshake after reconnect/restart and discard old references if instanceId changes. Never fall back to another editor or a latest alias. Cache/HTTP probe does not verify the Code Mode route. Do not loop on timeout; restart/reload Cocos Pilot to renew probes if IPC stays stuck.`);
    }
  }
  console.log('[cocos-pilot-bootstrap] During active work, optionally run node scripts/cocos-pilot-watchdog.js --url <selected endpoint> --project <absolute Creator project path> --instance <verified handshake instanceId> outside Creator. Stop mutations on unhealthy/stale observations; never retry a timed-out mutation blindly. Recovery requires read-back and a fresh Code Mode handshake. Monitoring does not enforce a server-side write lock or predict every freeze.');
  console.log('[cocos-pilot-bootstrap] Status can show session presence via editorSessionHeartbeat. A session harness may supervise node scripts/session-presence/heartbeat.js --url <bound endpoint> --project <project> --instance <verified ID> --session <unique session ID>. Helper beats use no LLM calls and are labeled http-helper, not verified Code Mode connectivity. Terminate the helper with its chat session; never feed routine beats into model context.');
}

// Test seam: pure helpers + core. main() path stays fs/http-coupled as before.
module.exports = { STALE_AFTER_MS, fetchJson, isLiveProbe, computeAgeMs, cacheKeyFor, buildCache, is3x, is2x, CANON_3X, CANON_2X };

if (require.main === module) {
  main().catch(() => process.exit(0));
}
