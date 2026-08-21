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

  const CANON = 'cc-bridge-2x';
  const SHORT = 'ccb-2x';
  const ALIASES_2X = new Set(['cc-bridge-2x', 'ccb-2x', 'cc_bridge_2x', 'ccb_2x']);
  const manuals = utcp.manual_call_templates.filter((m) => ALIASES_2X.has(m.name) || m.name === 'cc3x7');
  if (manuals.length === 0) return;

  const cache = { updatedAt: new Date().toISOString(), manuals: {} };
  for (const m of manuals) {
    const base = (m.url || '').replace(/\/utcp\/?$/, '');
    if (!base) continue;
    const manual = await fetchJson(`${base}/utcp`);
    const toolDefs = manual && Array.isArray(manual.tools) ? manual.tools : [];
    const tools = toolDefs.map((t) => t.name);
    const buildInfo = await fetchJson(`${base}/build-info`);
    const is2x = ALIASES_2X.has(m.name);
    const cacheKey = is2x ? (m.name === SHORT || m.name === 'ccb_2x' ? SHORT : CANON) : m.name;
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
