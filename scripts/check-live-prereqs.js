#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function discoverUtcp() {
  if (process.env.CCB_UTCP_URL) return process.env.CCB_UTCP_URL;
  const configPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), ".utcp_config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const manuals = (config.manual_call_templates || []).filter((item) => /^ccb3x(?:_\d+)?$/.test(item.name));
  if (manuals.length !== 1) {
    throw new Error(`Set CCB_UTCP_URL to the exact protected relay; found ${manuals.length} ccb3x manuals.`);
  }
  return manuals[0].url;
}

const utcp = discoverUtcp();
const gateway = process.env.CCB_GATEWAY_HEALTH || "http://127.0.0.1:18789/ccb/v1/health";

async function get(url) {
  try {
    const response = await fetch(url);
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: String((error && error.cause && error.cause.code) || error.message) };
  }
}

(async () => {
  const [manual, health] = await Promise.all([get(utcp), get(gateway)]);
  let tools = [];
  try { tools = JSON.parse(manual.body).tools || []; } catch { /* not a manual */ }
  const hasExec = tools.some((tool) => tool.name === "executeJavascript");
  const report = {
    utcp: { url: utcp, ok: manual.ok, status: manual.status, toolCount: tools.length, executeJavascript: hasExec },
    gateway: { url: gateway, ok: health.ok, status: health.status, body: health.body.slice(0, 200) },
    ready: Boolean(manual.ok && !hasExec && health.ok),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ready ? 0 : 1);
})();
