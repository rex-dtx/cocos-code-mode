#!/usr/bin/env node
// cc-bridge-bootstrap — SessionStart hook: register cc-bridge manuals from ~/.utcp_config.json
// and cache tool list to .claude/cc-bridge-cache.json (cc-bridge-cache only). Fail-open: never blocks session.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

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

async function main() {
  const home = os.homedir();
  const utcpPath = path.join(home, '.utcp_config.json');
  const utcp = readJson(utcpPath);
  if (!utcp || !Array.isArray(utcp.manual_call_templates) || utcp.manual_call_templates.length === 0) {
    return;
  }

  // STRICT new-format only: ccb3x / ccb2x (latest pointer) plus per-port
  // ccb3x_<port> / ccb2x_<port> for multi-editor. Legacy names (cc-bridge-3x,
  // cc3x7, cc-bridge-2x, cc2x4, ...) are NOT read — the extension purges them
  // from the config on start, so they must never reach registration here.
  const CANON_3X = 'ccb3x';
  const CANON_2X = 'ccb2x';
  const PERPORT_3X = /^ccb3x_\d+$/;
  const PERPORT_2X = /^ccb2x_\d+$/;
  const is3x = (m) => m.name === CANON_3X || PERPORT_3X.test(m.name);
  const is2x = (m) => m.name === CANON_2X || PERPORT_2X.test(m.name);
  const manuals = utcp.manual_call_templates.filter((m) => is3x(m) || is2x(m));
  if (manuals.length === 0) return;

  // Dedup by URL FIRST: the shared ~/.utcp_config.json may still carry a stale
  // alias + per-port entry for the same server. Collapse to one entry per unique
  // base URL so we fetch + register each server exactly once. Distinct editors
  // have distinct ports, so they survive as separate cache keys below.
  const byUrl = new Map();
  for (const m of manuals) {
    const base = (m.url || '').replace(/\/utcp\/?$/, '');
    if (!base) continue;
    const canon = is3x(m) ? CANON_3X : CANON_2X;
    const existing = byUrl.get(base);
    // Prefer the bare canonical name over a per-port/legacy name for the same URL.
    if (!existing || (m.name === canon && existing.name !== canon)) byUrl.set(base, m);
  }

  const cache = { updatedAt: new Date().toISOString(), manuals: {} };
  for (const [base, m] of byUrl) {
    const manual = await fetchJson(`${base}/utcp`);
    const toolDefs = manual && Array.isArray(manual.tools) ? manual.tools : [];
    const tools = toolDefs.map((t) => t.name);
    const buildInfo = await fetchJson(`${base}/build-info`);
    const three = is3x(m);
    const perPort = (three ? PERPORT_3X : PERPORT_2X).test(m.name);
    // Per-port editors keep their unique key; bare/legacy collapse to canonical.
    const cacheKey = perPort ? m.name : (three ? CANON_3X : CANON_2X);
    // A stale legacy entry for the same generation may still linger dead; prefer
    // a URL that actually answers over a dead one for the SAME cache key.
    const existing = cache.manuals[cacheKey];
    if (existing && existing.toolCount > 0 && tools.length === 0) continue;
    cache.manuals[cacheKey] = { url: m.url, toolCount: tools.length, tools, toolDefs, buildInfo: buildInfo || null, aliasOf: m.name !== cacheKey ? m.name : undefined };
  }

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');
  try {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'cc-bridge-cache.json'), JSON.stringify(cache, null, 2));
  } catch {}

  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && fs.existsSync(path.dirname(envFile))) {
    try { fs.appendFileSync(envFile, `CK_CODE_MODE=ready\n`); } catch {}
    for (const [name, info] of Object.entries(cache.manuals)) {
      try { fs.appendFileSync(envFile, `CK_CODE_MODE_${name.toUpperCase().replace(/-/g, '_')}=${info.toolCount}\n`); } catch {}
    }
  }

  const names = Object.keys(cache.manuals).join(', ');
  const total = Object.values(cache.manuals).reduce((s, v) => s + v.toolCount, 0);
  console.log(`[cc-bridge-bootstrap] cached ${names} (${total} tools) → .claude/cc-bridge-cache.json`);
}

main().catch(() => process.exit(0));
