'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let base = null;
let bound = false;

function discoverBase() {
  if (base) return base;
  const project = process.env.CCP2X_PROJECT;
  if (!project || !path.isAbsolute(project)) throw new Error('Set CCP2X_PROJECT to the intended absolute Creator project path.');
  const normalizedProject = path.normalize(project).replace(/[\\/]+$/, '');
  const sameProject = (value) => typeof value === 'string' && (process.platform === 'win32'
    ? path.normalize(value).replace(/[\\/]+$/, '').toLowerCase() === normalizedProject.toLowerCase()
    : path.normalize(value).replace(/[\\/]+$/, '') === normalizedProject);
  const utcpPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), '.utcp_config.json');
  const cfg = JSON.parse(fs.readFileSync(utcpPath, 'utf8'));
  const variables = cfg.variables || {};
  const requestedPort = process.env.UTCP_PORT || (process.env.UTCP_BASE && new URL(process.env.UTCP_BASE).port);
  const owned = (cfg.manual_call_templates || []).filter((entry) => {
    const match = /^ccp2x_(\d+)$/.exec(entry?.name || '');
    return match && (!requestedPort || match[1] === requestedPort)
      && entry.url === `http://localhost:${match[1]}/utcp`
      && variables[`CCP2X_OWNER_${match[1]}`]
      && sameProject(variables[`CCP2X_PROJECT_${match[1]}`]);
  });
  if (owned.length !== 1) throw new Error(`Expected exactly one owned ccp2x_<port> for CCP2X_PROJECT; found ${owned.length}.`);
  base = owned[0].url.replace(/\/utcp$/, '');
  return base;
}

async function getJson(urlPath, init) {
  const b = discoverBase();
  if (!bound && !urlPath.startsWith('/tools/editorHandshake?')) {
    const project = process.env.CCP2X_PROJECT;
    const response = await fetch(b + `/tools/editorHandshake?expectedProjectPath=${encodeURIComponent(project)}&timeoutMs=1000`);
    const handshake = await response.json();
    if (!response.ok || handshake.projectMatches !== true || handshake.probe?.status !== 'responsive') {
      throw new Error('editorHandshake did not confirm the intended project');
    }
    bound = true;
  }
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
