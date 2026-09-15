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
async function emitCreatorTrace(baseUrl, level, message, data) {
  try {
    const response = await fetch(baseUrl + '/tools/editorLog', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, message, data }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`status=${response.status}`);
  } catch {
    // Preserve the diagnostic locally without changing the tool's outcome.
    console.warn(`[LT] TRACE_UNAVAILABLE | ${message}`);
  }
}


function formatTraceParams(urlPath, init) {
  const values = Object.create(null);
  const query = urlPath.split('?')[1];
  if (query) for (const [key, value] of new URLSearchParams(query)) values[key] = value;
  if (init?.body !== undefined) {
    try {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      if (body && typeof body === 'object' && !Array.isArray(body)) Object.assign(values, body);
    } catch {}
  }
  return summarizeTraceResult(values);
}

function summarizeTraceResult(body) {
  const seen = new WeakSet();
  let count = 0;
  let truncated = false;
  const serialized = JSON.stringify(body, (key, value) => {
    if (/password|secret|token|authorization|cookie|api.?key|credential/i.test(key)) return '[REDACTED]';
    if (++count > 100) { truncated = true; return '[truncated]'; }
    if (typeof value === 'string' && value.length > 180) {
      truncated = true;
      return value.slice(0, 180) + '[truncated]';
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
    }
    return value;
  }) ?? 'undefined';
  const text = serialized.length > 1600 ? serialized.slice(0, 1600) : serialized;
  return text + (truncated || serialized.length > 1600 ? ' [truncated]' : '');
}

async function getJson(urlPath, init) {
  const b = discoverBase();
  const url = b + urlPath;
  const functionName = urlPath.split('?')[0].replace(/^\/tools\//, '').replace(/^\//, '');
  const traceParams = formatTraceParams(urlPath, init);
  const trace = process.env.UTCP_TEST_TRACE !== '0';
  const traceId = require('crypto').randomBytes(4).toString('hex');
  if (trace && urlPath !== '/tools/editorLog') {
    await emitCreatorTrace(b, 'info', `[LT][${traceId}] ${new Date().toISOString()} ${functionName} REQ | params=${traceParams}`);
  }
  const startedAt = performance.now();
  let r;
  let text;
  try {
    r = await fetch(url, init);
    text = await r.text();
  } catch (error) {
    if (trace && urlPath !== '/tools/editorLog') {
      // Do not print fetch messages: they can contain transport URLs/credentials.
      const kind = init?.signal?.aborted ? 'ABORTED' : r ? 'RESPONSE_READ_FAILED' : 'CONNECTION_FAILED';
      const message = `[LT][${traceId}] ${new Date().toISOString()} ${functionName} ${kind} | elapsed=${(performance.now() - startedAt).toFixed(1)}ms | params=${traceParams}`;
      await emitCreatorTrace(b, 'error', message);
    }
    throw error;
  }
  const durationMs = (performance.now() - startedAt).toFixed(1);
  let body;
  let parsed = true;
  try { body = JSON.parse(text); } catch { body = text; parsed = false; }
  if (trace && urlPath !== '/tools/editorLog') {
    const serverId = r.headers.get('x-request-id');
    const serverDuration = r.headers.get('x-duration-ms');
    const correlation = serverId && /^[a-zA-Z0-9_-]{1,128}$/.test(serverId) ? ` | serverId=${serverId}` : '';
    const timing = serverDuration && /^\d+(?:\.\d+)?$/.test(serverDuration) ? ` | server=${serverDuration}ms` : '';
    await emitCreatorTrace(b, r.ok ? 'info' : 'warn', `[LT][${traceId}] ${new Date().toISOString()} ${functionName} ${r.ok ? 'OK' : 'ERR'} ${r.status}${correlation} | result=${summarizeTraceResult(body)} | elapsed=${durationMs}ms${timing} | bytes=${Buffer.byteLength(text, 'utf8')}${parsed ? '' : ' | NON_JSON'}`);
  }
  return { ok: r.ok, status: r.status, body, text, base: b };
}

async function getExpectedErrorJson(urlPath, testId, init = {}) {
  return getJson(urlPath, {
    ...init,
    headers: {
      ...init.headers,
      'x-ccb-expected-error': 'true',
      'x-ccb-test-id': testId,
    },
  });
}


async function postTool(toolPath, body) {
  return getJson(`/tools/${toolPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function postExpectedErrorTool(toolPath, body, testId) {
  return getJson(`/tools/${toolPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ccb-expected-error': 'true',
      'x-ccb-test-id': testId,
    },
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

async function getCanvasReference() {
  const result = await getJson('/tools/findNodes?componentType=cc.Canvas&maxResults=1');
  if (!result.ok) return null;
  return result.body?.nodes?.[0]?.reference ?? null;
}

function resVal(body) {
  if (body == null) return null;
  if (typeof body === 'object' && 'result' in body) return body.result;
  return null;
}

module.exports = { discoverBase, getJson, getExpectedErrorJson, postTool, postExpectedErrorTool, healthCheck, getCanvasReference, resVal };
