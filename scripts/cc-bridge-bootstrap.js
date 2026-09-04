#!/usr/bin/env node
// cc-bridge-bootstrap — SessionStart hook: fetch live cc-bridge manuals from
// ~/.utcp_config.json and cache tool metadata to .claude/cc-bridge-cache.json.
// It never registers manuals in the Code Mode MCP process; agents do that per session.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const CANON_3X = 'ccb3x';
const CANON_2X = 'ccb2x';
const PERPORT_3X = /^ccb3x_\d+$/;
const PERPORT_2X = /^ccb2x_\d+$/;

// Max age before a cached entry that has not been re-probed live is marked stale.
// Mirrors runbook §3 readiness: age_ms = now - fetchedAt; is_stale = age_ms > threshold.
// Threshold env-overridable for tests. 24h matches plan P0 "without successful probe".
const STALE_AFTER_MS = Number(process.env.CC_BRIDGE_CACHE_MAX_AGE_MS) || 24 * 60 * 60 * 1000;

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function fetchJson(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

function is3x(m) { return m.name === CANON_3X || PERPORT_3X.test(m.name); }
function is2x(m) { return m.name === CANON_2X || PERPORT_2X.test(m.name); }

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
  const three = is3x(m);
  const perPort = (three ? PERPORT_3X : PERPORT_2X).test(m.name);
  return perPort ? m.name : (three ? CANON_3X : CANON_2X);
}

/**
 * Pure core: merge prior disk cache with this run's probes.
 * - Per-manual independence: ccb3x and ccb2x (and per-port keys) are decided separately.
 * - Live probe → write authoritative entry with fetchedAt/age_ms:0.
 * - Dead probe + prior authoritative entry → retain prior, update age_ms + stale marker, never clobber count.
 * - Dead probe + no prior → tombstone (authoritative:false), never an authoritative 0 entry.
 * - Prior keys not probed this run are retained with age_ms refresh + max-age stale mark.
 * Exported for unit tests (inject fetchJson/now).
 */
async function buildCache({ utcpConfig, priorCache, fetchJson: doFetch, now }) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const priorManuals = (priorCache && priorCache.manuals) || {};

  const manualsIn = (utcpConfig && Array.isArray(utcpConfig.manual_call_templates))
    ? utcpConfig.manual_call_templates.filter((m) => is3x(m) || is2x(m))
    : [];
  // Dedup by URL: same editor may appear as both canonical and per-port alias.
  const byUrl = new Map();
  for (const m of manualsIn) {
    const base = (m.url || '').replace(/\/utcp\/?$/, '');
    if (!base) continue;
    const canon = is3x(m) ? CANON_3X : CANON_2X;
    const existing = byUrl.get(base);
    if (!existing || (m.name === canon && existing.name !== canon)) byUrl.set(base, m);
  }

  // Seed result with prior keys not probed this run (retained with refreshed age_ms).
  const probedKeys = new Set();
  const nextManuals = {};

  // Bring forward every prior key initially; probed ones will be overwritten below.
  // We populate nextManuals lazily inside the loop for probed keys and copy the
  // rest afterwards, so age_ms for untouched keys is still recomputed once.
  for (const [base, m] of byUrl) {
    const cKey = cacheKeyFor(m);
    // If multiple URLs collapse to the same cacheKey, the liveness rule "prefer a
    // URL that actually answers over a dead one for SAME cacheKey" is enforced by
    // the dead→retain logic: a dead probe for this key never overwrites a live one.
    if (probedKeys.has(cKey)) continue; // already decided this generation key (deduped by URL already; extra guard for same-key multi-URL)
    probedKeys.add(cKey);

    const manual = await doFetch(`${base}/utcp`);
    const toolDefs = manual && Array.isArray(manual.tools) ? manual.tools : [];
    const tools = toolDefs.map((t) => t.name);
    const buildInfo = await doFetch(`${base}/build-info`);
    const live = isLiveProbe(manual, buildInfo, toolDefs.length);

    const prior = priorManuals[cKey];

    if (live) {
      nextManuals[cKey] = {
        url: m.url,
        toolCount: toolDefs.length,
        tools,
        toolDefs,
        buildInfo: buildInfo || null,
        fetchedAt: nowIso,
        age_ms: 0,
        live: true,
        authoritative: true,
        stale: false,
        aliasOf: m.name !== cKey ? m.name : undefined,
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
          live: false,
          stale: true,
          staleReason: overMaxAge ? 'max_age' : 'probe_failed',
        };
      } else if (prior && prior.authoritative === false) {
        // Prior was already a tombstone — keep it, refresh age, stay stale.
        const ageMs = computeAgeMs(prior.fetchedAt, nowMs);
        nextManuals[cKey] = {
          ...prior,
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
          fetchedAt: nowIso,
          age_ms: 0,
          live: false,
          authoritative: false,
          stale: true,
          staleReason: 'probe_failed',
          aliasOf: m.name !== cKey ? m.name : undefined,
        };
      }
    }
  }

  // Retain prior keys that were not probed this run (e.g. a generation absent from
  // utcp_config this session). Their age keeps ticking and max-age still marks them.
  for (const [k, v] of Object.entries(priorManuals)) {
    if (nextManuals[k] !== undefined) continue;
    const ageMs = computeAgeMs(v.fetchedAt || v.updatedAt || priorCache.updatedAt, nowMs);
    if (ageMs != null && ageMs > STALE_AFTER_MS) {
      nextManuals[k] = { ...v, age_ms: ageMs, stale: true, staleReason: 'max_age', live: false };
    } else if (ageMs != null) {
      // Keep as-is but keep age_ms fresh so readers can run age_ms = now - fetchedAt.
      nextManuals[k] = { ...v, age_ms: ageMs };
    } else {
      nextManuals[k] = { ...v };
    }
  }

  return { updatedAt: nowIso, manuals: nextManuals };
}

async function main() {
  const home = os.homedir();
  const utcpPath = path.join(home, '.utcp_config.json');
  const utcp = readJson(utcpPath);
  if (!utcp || !Array.isArray(utcp.manual_call_templates) || utcp.manual_call_templates.length === 0) {
    return;
  }
  const manuals = utcp.manual_call_templates.filter((m) => is3x(m) || is2x(m));
  if (manuals.length === 0) return;

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');
  const cachePath = path.join(claudeDir, 'cc-bridge-cache.json');
  const priorCache = readJson(cachePath);
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
  console.log(`[cc-bridge-bootstrap] cached ${names} (${liveTotal} live tools) → .claude/cc-bridge-cache.json${staleNote}`);
}

// Test seam: pure helpers + core. main() path stays fs/http-coupled as before.
module.exports = { STALE_AFTER_MS, isLiveProbe, computeAgeMs, cacheKeyFor, buildCache, is3x, is2x, CANON_3X, CANON_2X };

if (require.main === module) {
  main().catch(() => process.exit(0));
}
