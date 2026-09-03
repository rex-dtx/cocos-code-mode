---
name: cc-scene-graph
description: >
  Use when a task needs Cocos scene/project structure: find nodes by component,
  script, path, or text; scope by bundle; or resume prior scene context. Wraps
  the cocos-graph offline index (handle-first) and enforces live-read-before-mutate.
---

# cc-scene-graph

Offline structural index for the authoring Cocos project. Answers **where/what** (T1) without touching the editor; live bridge answers **how much** (T2) and every write.

## When to use cocos-graph instead of grep / nodeGetTree loops

| Intent | Use |
|---|---|
| Find / plan — "which nodes have X", "where is Y", "parents of N" | `cocos-graph query` (T1) |
| Read-modify-write on node N | `cocos-graph query` → `inspectorGet` live → `inspectorSet`/`nodeOperate` |
| Runtime value, material param, viewport | bridge only — never the index |
| `grep` over `assets/` for node names/uuids | `cocos-graph query --text` — fewer tokens, bundle-scoped |

Default to the index for structural search. Use `nodeGetTree` only to **resolve one handle** or when `stale` says advisory.

## Tier model (plan §Cacheability)

- **T0 identity** — `uuid`, node `_id`, `fileId` — durable, permanent.
- **T1 structure** — hierarchy, component attachment, script path — **indexed** (committed). Becomes advisory when `dirty:true`.
- **T2 state** — `position`/`rotation`/`active`/every property value — **never indexed**; always `inspectorGet` live before mutate.
- **T3 ephemeral** — selection, undo stack — never indexable.

Rule: index answers `where`/`what`, never `how much`. Before any mutation, live `inspectorGet` the exact target (T2 rule).

## CLI — `tools/cocos-graph` (Node 22, 0 deps)

```bash
# Build — output is <project>/.cocos-graph/<bundle>/graph.json + _manifest.json
node tools/cocos-graph/bin/cocos-graph.mjs build --project <path> [--bundle <name>] [--live-json <path>] [--out .cocos-graph]

# Query — at most one filter; multiple = AND; handle-first JSON to stdout
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle <name> [--by-component <type>] [--by-script <uuid|path>] [--path-glob <glob>] [--text <q>] [--limit 50] [--cursor <n>]

# Validate — live-vs-disk counts for the open scene, reports prefabOpaque
node tools/cocos-graph/bin/cocos-graph.mjs validate --bundle <name> [--project <path>]
```

`<project>` is the authored Cocos project (e.g. `G:/_ws/cc-fws/cc30-new-all-in-one`). `--bundle` scopes to `assets/<bundle>/` (e.g. `cc-common`, `cc-release-slot`). Omit `--bundle` on `build` to build all shards.

Query stdout (always one JSON line, exit 0):
```json
{"total":42,"truncated":false,"cursor":null,"handles":[{"uuid":"c0y6...","path":"/Canvas/Player","name":"Player","file":"assets/.../g9664L.scene"}],"stale":{"age_ms":12000,"dirty":false,"prefabOpaque":false}}
```

Errors (exit 2, stderr one-liner, nothing on stdout) — distinguish from "0 matches":
- `cocos-graph: shard not built for bundle "<name>" (run: cocos-graph build ...)`
- `cocos-graph: shard <name> is stale or unreadable (parserVersion "3" expected, run build)`
- Built OK but no matches → exit 0 with `"total":0,"handles":[]`.

`parserVersion` is `"3"`; any other on disk is treated as stale.

## Handle-first discipline (T2 live-read-before-mutate)

1. `cocos-graph query --bundle <b> --by-component "cc.Sprite"` → collect `handles[].uuid`
2. `inspectorGet({target:"instance", reference:{id: uuid}})` → live state for the chosen target only
3. `inspectorSet` / `nodeOperate` / `nodeComponentManage` with the fresh value

Never dump a whole scene, never write from index values, never use `__id__` (positional — breaks on re-save; stable keys are `uuid`/`_id`/`fileId`).

## Bundle scoping

`query` always requires `--bundle` (the shard). To answer cross-bundle questions, query each shard separately — do not load all shards at once. The active work's `bundle` lives in `.claude/ccb-session.json` (see below).

## Staleness — check before trusting structure

Every query `stale`:
- `age_ms = now - builtAt` — banner when `age_ms > 2000` and the manifest predates the last edit.
- `dirty` mirrors `sceneGetInfo().dirty` when available — if `true`, T1 is advisory; re-read via `nodeGetTree`/`sceneGetInfo` live.
- `prefabOpaque:true` — disk shard has no prefab-expanded children; live-sourced shard only (`live` + `liveNodes`) does.

Pattern (codegraph #403): non-blocking banner, never `throw`. If stale/advisory, fallback to `ccb3x.nodeGetTree` / `ccb3x.sceneGetInfo` for the target path.

## Session artifact — `.claude/ccb-session.json` (Concern A)

Small per-worktree file, gitignored, written by the agent after meaningful scene work, read at session start. Same `age_ms` gate as the index.

```json
{
  "bundle": "cc-release-slot",
  "sceneUuid": "80dddede-...",
  "workingPath": "/Canvas/Player",
  "task": "swap texture X -> Y on cc.Sprite",
  "updatedAt": "2026-09-03T10:12:03.122Z",
  "age_ms": 1200,
  "project": "G:/_ws/cc-fws/cc30-new-all-in-one"
}
```

- `bundle`/`sceneUuid`/`workingPath`/`task` — what/where you left off.
- `updatedAt` (ISO 8601) — reference instant; written `age_ms` is only a hint.
- `project` — Cocos project root so the hook can find `<project>/.cocos-graph/_manifest.json`.
- Read side: `age_ms = Date.now() - Date.parse(updatedAt)` (fallback to written `age_ms`). Gate: `age_ms > 2000` or `manifest.builtAt < updatedAt` → stale.

Write it from the agent (Write tool / `fs.writeFileSync`) at the end of a scene task. Delete it when switching tasks.

## SessionStart banner — `session-staleness.mjs`

` .claude/skills/cc-scene-graph/session-staleness.mjs` reads `ccb-session.json` + `<project>/.cocos-graph/_manifest.json`, computes ages, and prints a non-blocking banner (stdout, exit 0) — never authoritative, never blocking. Register as a second `SessionStart` hook alongside `cc-bridge-bootstrap.js`:

```json
{ "hooks": { "SessionStart": [{ "hooks": [
  { "type": "command", "command": "node ./scripts/cc-bridge-bootstrap.js", "timeout": 10 },
  { "type": "command", "command": "node ./.claude/skills/cc-scene-graph/session-staleness.mjs", "timeout": 5 }
]}]}}
```

If your bootstrap owns `settings.json`, merge the second entry there instead of overwriting — `staleness.mjs` is additive and never touches the bridge cache.

## Examples — B-intent queries (T1)

```bash
# by component type
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle cc-release-slot --by-component "cc.Sprite" --limit 20

# by script (uuid or db url)
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle cc-release-slot --by-script "f1a2..."

# by path glob
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle cc-common --path-glob "/Canvas/Player/*"

# text over node names (case-insensitive substring)
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle cc-release-slot --text "Player"

# combine (AND) + paginate
node tools/cocos-graph/bin/cocos-graph.mjs query --bundle cc-release-slot --by-component "cc.Label" --text "Score" --limit 50 --cursor 50
```

Each returns handles; to inspect one: `ccb3x.inspectorGet({target:"instance", reference:{id: handle.uuid}})`. Before any write, verify `ccb3x.sceneGetInfo().dirty`.

## Do not

- Cache or write `position`/`active`/material values from the index — `inspectorGet` live every time.
- `grep` for node names when the same query exists as `--text`; do not loop `nodeGetTree` to search.
- Treat `exit 0 + total:0` as "not built" — only `exit 2` means build is needed.
- Assume T3 (runtime `cc.Node` instances) are indexable — `findRuntimeNodeUuid` stays live DFS.
