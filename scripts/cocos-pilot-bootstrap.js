#!/usr/bin/env node
// SessionStart cache for the exact project-bound Cocos Pilot 2x manual.
// Fail-open: absence of a live editor never blocks the agent session.
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
  const project = process.env.CCP2X_PROJECT;
  if (!project || !path.isAbsolute(project)) return;
  const normalizedProject = path.normalize(project).replace(/[\\/]+$/, '');
  const sameProject = (value) => typeof value === 'string' && (process.platform === 'win32'
    ? path.normalize(value).replace(/[\\/]+$/, '').toLowerCase() === normalizedProject.toLowerCase()
    : path.normalize(value).replace(/[\\/]+$/, '') === normalizedProject);
  const utcpPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), '.utcp_config.json');
  const utcp = readJson(utcpPath);
  if (!utcp || !Array.isArray(utcp.manual_call_templates)) return;
  const variables = utcp.variables || {};
  const manuals = utcp.manual_call_templates.filter((entry) => {
    const match = /^ccp2x_(\d+)$/.exec(entry && entry.name);
    return match && entry.url === `http://localhost:${match[1]}/utcp`
      && variables[`CCP2X_OWNER_${match[1]}`]
      && sameProject(variables[`CCP2X_PROJECT_${match[1]}`]);
  });
  if (manuals.length !== 1) return;

  const entry = manuals[0];
  const base = entry.url.replace(/\/utcp$/, '');
  const manual = await fetchJson(`${base}/utcp`);
  if (!manual || !Array.isArray(manual.tools)) return;
  const handshake = await fetchJson(`${base}/tools/editorHandshake?expectedProjectPath=${encodeURIComponent(project)}&timeoutMs=1000`);
  if (!handshake || handshake.projectMatches !== true || handshake.probe?.status !== 'responsive') return;
  const toolDefs = manual.tools;
  const tools = toolDefs.map((tool) => tool.name);
  const buildInfo = await fetchJson(`${base}/build-info`);
  const cache = { updatedAt: new Date().toISOString(), manuals: {
    [entry.name]: { url: entry.url, toolCount: tools.length, tools, toolDefs, buildInfo: buildInfo || null, instanceId: handshake.instanceId, projectPath: project },
  } };
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectRoot, '.claude');
  try {
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'cocos-pilot-2x-cache.json'), JSON.stringify(cache, null, 2));
  } catch { return; }

  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && fs.existsSync(path.dirname(envFile))) {
    try { fs.appendFileSync(envFile, `CK_CODE_MODE=ready\nCK_CODE_MODE_${entry.name.toUpperCase()}=${tools.length}\n`); } catch {}
  }
  console.log(`[cocos-pilot-bootstrap] cached ${entry.name} (${tools.length} tools) → .claude/cocos-pilot-2x-cache.json`);
}

main().catch(() => process.exit(0));
