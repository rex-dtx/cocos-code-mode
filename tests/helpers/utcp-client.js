'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let base = null;

function discoverBase() {
  if (base) return base;
  if (process.env.UTCP_BASE) {
    base = process.env.UTCP_BASE.replace(/\/$/, '');
    return base;
  }
  const port = Number(process.env.UTCP_PORT || 0);
  if (port) {
    base = `http://localhost:${port}`;
    return base;
  }
  try {
    const utcpPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), '.utcp_config.json');
    const cfg = JSON.parse(fs.readFileSync(utcpPath, 'utf8'));
    const tpls = cfg.manual_call_templates || [];
    const canon = tpls.find((t) => t && t.name === 'ccb2x')
      || tpls.find((t) => t && /^ccb2x(_\d+)?$/.test(t.name))
      || tpls.find((t) => t && t.name === 'cc-bridge-2x');
    const m = String((canon && canon.url) || '').match(/localhost:(\d+)/);
    if (m) {
      base = `http://localhost:${m[1]}`;
      return base;
    }
  } catch {}
  throw new Error('Cannot discover UTCP port: is cc-bridge-2x running? Set UTCP_BASE or UTCP_PORT.');
}

async function getJson(urlPath, init) {
  const b = discoverBase();
  const r = await fetch(b + urlPath, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
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
    const tools = (r.body && r.body.tools) || [];
    const n = Array.isArray(tools) ? tools.length : -1;
    const hasExec = tools.some((t) => t.name === 'executeJavascript');
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
