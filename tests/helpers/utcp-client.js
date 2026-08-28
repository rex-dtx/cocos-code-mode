const fs = require('fs');
const path = require('path');

let base = null; // resolved once

function discoverBase() {
  if (base) return base;
  if (process.env.UTCP_BASE) { base = process.env.UTCP_BASE.replace(/\/$/, ''); return base; }
  const port = Number(process.env.UTCP_PORT || process.argv.find(a => /^\d{4,5}$/.test(a)) || 0);
  if (port) { base = `http://localhost:${port}`; return base; }
  try {
    const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
    const utcpPath = process.env.UTCP_CONFIG_FILE || path.join(home, '.utcp_config.json');
    const raw = fs.readFileSync(utcpPath, 'utf8');
    const cfg = JSON.parse(raw);
    const tpls = cfg.manual_call_templates || [];
    // Prefer ccb3x (3.7) over ccb2x; these tests target the 3.7 bridge.
    const canon = tpls.find(t => /^ccb3x/.test(t.name))
      || tpls.find(t => /^ccb2x$/.test(t.name))
      || tpls[0];
    const m = String(canon && canon.url || '').match(/localhost:(\d+)/);
    if (m) { base = `http://localhost:${m[1]}`; return base; }
  } catch {}
  throw new Error('Cannot discover UTCP port: is cc-bridge-3x running? Set UTCP_BASE or pass --utcp-port=49650.');
}

async function getJson(urlPath, init) {
  const b = discoverBase();
  const url = b + urlPath;
  const r = await fetch(url, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { ok: r.ok, status: r.status, body, text, base: b };
}

async function postTool(toolPath, body) {
  return getJson(`/tools/${toolPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function healthCheck() {
  try {
    const r = await getJson('/utcp');
    if (!r.ok) return { ok: false, reason: `GET /utcp -> ${r.status}` };
    const n = Array.isArray(r.body && r.body.tools) ? r.body.tools.length : -1;
    const hasExec = (r.body.tools || []).some(t => t.name === 'executeJavascript');
    return { ok: true, toolCount: n, hasExec, base: r.base };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function resVal(body) {
  if (body == null) return null;
  if (typeof body === 'object' && 'result' in body) return body.result;
  return null;
}

module.exports = { discoverBase, getJson, postTool, healthCheck, resVal };
