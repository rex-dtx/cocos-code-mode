#!/usr/bin/env node
// ccb-session-staleness — SessionStart companion hook for the cc-scene-graph skill.
//
// Reads the two on-disk state files and prints a NON-BLOCKING banner:
//   1. .claude/ccb-session.json      — where the agent left off (Concern A)
//   2. <project>/.cocos-graph/_manifest.json — when the index was built (Concern C)
//
// It never fails the session and never mutates anything: exit 0 on every path,
// stdout only, plain text (same convention as scripts/cc-bridge-bootstrap.js).
// `dirty` is NOT readable here — that needs the live editor, so the banner tells
// the agent to check `sceneGetInfo` before trusting structure. See SKILL.md.
//
// Registration (second SessionStart command, so this file stays independent of
// cc-bridge-bootstrap.js): .claude/settings.json -> hooks.SessionStart
import fs from 'node:fs';
import path from 'node:path';

// Gate mirrors arch.md section 5 / Unity Coplay age_ms > 2000 -> is_stale.
const STALE_MS = Number(process.env.CCB_SESSION_STALE_MS || 2000);
const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PREFIX = '[ccb-session]';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Reference instant: prefer updatedAt; fall back to now - age_ms if the agent
// wrote only the hint. Returns age in ms, or null when neither is usable.
function ageOf(session) {
  const stamp = Date.parse(String(session?.updatedAt ?? ''));
  if (Number.isFinite(stamp)) return Date.now() - stamp;
  const hint = Number(session?.age_ms);
  return Number.isFinite(hint) ? hint : null;
}

// The index lives in the authored Cocos project, not this extension repo, so it is
// reachable only through the session's project field (or env override).
function projectDir(session) {
  const p = process.env.CC_PROJECT_DIR || session?.project;
  if (!p) return null;
  try { return fs.statSync(p).isDirectory() ? p : null; } catch { return null; }
}

function main() {
  const session = readJson(path.join(ROOT, '.claude', 'ccb-session.json'));
  if (!session) return null; // first session in this worktree — nothing to report

  const banner = [];
  let stale = false;
  const note = (msg) => { stale = true; banner.push(msg); };

  const where = [
    session.bundle && `bundle=${session.bundle}`,
    session.sceneUuid && `scene=${session.sceneUuid}`,
    session.workingPath && `node=${session.workingPath}`,
  ].filter(Boolean).join(' ');
  if (session.task) banner.push(`last context: ${session.task}${where ? ` (${where})` : ''}`);

  const sessionAge = ageOf(session);
  if (sessionAge !== null && sessionAge > STALE_MS) {
    note(`session artifact is ${fmt(sessionAge)} old — re-verify before acting on it`);
  }

  const project = projectDir(session);
  if (!project) {
    note('no project in ccb-session.json — cannot locate .cocos-graph/_manifest.json; treat any remembered graph as unbuilt');
    return { banner, stale };
  }

  const manifest = readJson(path.join(project, '.cocos-graph', '_manifest.json'));
  if (!manifest || !Array.isArray(manifest.shards)) {
    note(`index NOT BUILT for ${project} — run cocos-graph build --project "${project}" --bundle <name> before any structural query`);
    return { banner, stale };
  }

  const builtAge = Number.isFinite(manifest.builtAt) ? Date.now() - manifest.builtAt : null;
  const shard = manifest.shards.find((s) => s.name === session.bundle);
  if (!shard) {
    note(`no shard "${session.bundle}" in _manifest.json (parserVersion ${manifest.parserVersion}) — build it or scope to an existing bundle`);
    return { banner, stale };
  }

  // Index predates the last recorded edit — stale.
  if (Number.isFinite(manifest.builtAt) && Number.isFinite(sessionAge) && manifest.builtAt < Date.now() - sessionAge) {
    note(`_manifest.json built ${fmt(builtAge)} ago, BEFORE the last recorded scene edit — shard is advisory, rebuild it`);
  }

  const status = `shard "${shard.name}": source=${shard.source ?? 'disk'} files=${shard.files ?? '?'}${shard.liveNodes != null ? ` liveNodes=${shard.liveNodes}` : ''} age=${fmt(builtAge)} parserVersion=${manifest.parserVersion}`;
  if (stale) banner.unshift(status);
  else banner.push(status);

  // D8: only a live-sourced shard contains prefab-expanded children.
  if (shard.source !== 'live') {
    note(`shard "${shard.name}" is not live-sourced — prefab-expanded children are absent; verify with nodeGetTree`);
  }
  if (shard.prefabOpaque === true) {
    note(`shard "${shard.name}" prefabOpaque=true — top-level structure only, never prefab internals`);
  }
  if (Number.isFinite(builtAge) && builtAge > STALE_MS) {
    note(`index age_ms=${builtAge} exceeds gate ${STALE_MS} — trust it for structure only, never for values`);
  }

  banner.push(stale
    ? 'stale signal above: re-check ccb3x.sceneGetInfo().dirty and fall back to nodeGetTree before any write'
    : 'dirty is unknown offline — call ccb3x.sceneGetInfo() before relying on structure for a write');
  return { banner, stale };
}

function fmt(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

try {
  const result = main();
  if (result?.banner?.length) {
    console.log(`${PREFIX} ${result.stale ? 'STALE — advisory, non-blocking' : 'resumed context — index looks fresh'}:`);
    for (const line of result.banner) console.log(`${PREFIX} - ${line}`);
  }
} catch {
  // A broken staleness probe must never block or pollute a session.
}
process.exit(0);
