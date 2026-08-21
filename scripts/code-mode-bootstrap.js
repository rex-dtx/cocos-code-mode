#!/usr/bin/env node
// cc-remoter-bootstrap — SessionStart hook: register cc-remoter manuals from ~/.utcp_config.json
// and cache tool list to .claude/cc-remoter-cache.json (compat alias cc-code-mode-cache.json). Fail-open: never blocks session.
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
    // Cocos not running yet — nothing to cache. Fail-open.
    return;
  }

  const ALIASES_3X = new Set(['cc-remoter-3x','ccr-3x','cc-remoter-v3x7','cc_remoter_v3x7','cc_remoter_3x','ccr_3x','cc3x7','cc37','CocosEditor3x7','CocosEditor3x']);
  const ALIASES_2X = new Set(['cc-remoter-2x','ccr-2x','cc-remoter-v2x4','cc_remoter_v2x4','cc_remoter_2x','ccr_2x','cc2x4','cc24','CocosEditor','CocosEditor2x']);
  const CANON_3X='cc-remoter-3x', SHORT_3X='ccr-3x';
  const manuals = utcp.manual_call_templates.filter((m) => ALIASES_3X.has(m.name) || ALIASES_2X.has(m.name));
  if (manuals.length === 0) return;

  const cache = { updatedAt: new Date().toISOString(), manuals: {} };
  for (const m of manuals) {
    // m.url like http://localhost:52770/utcp
    const base = (m.url || '').replace(/\/utcp\/?$/, '');
    if (!base) continue;
    const manual = await fetchJson(`${base}/utcp`);
    const toolDefs = manual && Array.isArray(manual.tools) ? manual.tools : [];
    const tools = toolDefs.map((t) => t.name);
    // build-info is out-of-schema for /utcp, lives on its own endpoint
    const buildInfo = await fetchJson(`${base}/build-info`);
    const is3x = ALIASES_3X.has(m.name);
    const cacheKey = is3x ? (m.name === SHORT_3X || m.name === 'ccr_3x' ? SHORT_3X : CANON_3X) : (ALIASES_2X.has(m.name) ? (m.name === 'ccr-2x' || m.name === 'ccr_2x' ? 'ccr-2x' : 'cc-remoter-2x') : m.name);
    cache.manuals[cacheKey] = { url: m.url, toolCount: tools.length, tools, toolDefs, buildInfo: buildInfo || null, aliasOf: m.name !== cacheKey ? m.name : undefined };
  }

  // write project-local cache (.claude/cc-code-mode-cache.json) — prefer project dir from env/hook cwd
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');
  try {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'cc-remoter-cache.json'), JSON.stringify(cache, null, 2));
    try { fs.writeFileSync(path.join(claudeDir, 'cc-code-mode-cache.json'), JSON.stringify(cache, null, 2)); } catch {}
  } catch {}

  // inject env for this session so the agent can check CK_CODE_MODE without reading file
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && fs.existsSync(path.dirname(envFile))) {
    try { fs.appendFileSync(envFile, `CK_CODE_MODE=ready\n`); } catch {}
    // also expose per-manual counts for quick checks
    for (const [name, info] of Object.entries(cache.manuals)) {
      try { fs.appendFileSync(envFile, `CK_CODE_MODE_${name.toUpperCase()}=${info.toolCount}\n`); } catch {}
    }
  }

  const names = Object.keys(cache.manuals).join(', ');
  const total = Object.values(cache.manuals).reduce((s, v) => s + v.toolCount, 0);
  console.log(`[cc-remoter-bootstrap] cached ${names} (${total} tools) → .claude/cc-remoter-cache.json`);
}

main().catch(() => process.exit(0));
