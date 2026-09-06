---
name: cc-scene-graph
description: Use for Cocos scene/project structural search, composite node resolution, bounded hierarchy navigation, asset references, or session continuation. Uses the offline T0/T1 graph and requires a live read before every mutation.
---

# cc-scene-graph

Offline structural navigation for saved Creator 2.4 assets. The graph answers **where/what**; CC Bridge remains authoritative for unsaved state, runtime state, and every write.

This skill is a companion CLI. It is not a UTCP tool and is not loaded into the Creator process.

## Authority model

- T0 identity: engine UUID plus source file. Indexed as composite `handle = <file>#<uuid>`.
- T1 structure: saved hierarchy, component attachment, script identity, asset references. Indexed.
- T2 mutable values: transforms, active state, component values. Never indexed.
- T3 runtime/editor state: selection, viewport, undo, runtime instances. Never indexed.

Node UUIDs and prefab `fileId` values are file-local. Never pass a composite handle directly to Cocos. Resolve its `uuid`, then confirm the exact live scene/target through CC Bridge.

Missing `_id`/`fileId` records are omitted. `prefabOpaque=true` plus omission counters mean the disk graph is incomplete — use live overlay or `readPrefabJson`. Never synthesize a UUID.

## Cache layout

```text
<project>/.cocos-graph/<namespace>/
  _manifest.json
  <bundle>/graph-<semantic-hash>.json
```

`--isolate` or `CC_GRAPH_ISOLATE=1` selects a branch/worktree namespace. `CC_GRAPH_SLUG` overrides its slug. `--out` wins over `CC_GRAPH_OUT`, which wins over isolation defaults. Manifest dialect is `parserVersion: "4"` plus `engineProfile: "creator-2.4"`.

`session-staleness.mjs` is manual. SessionStart does not run it unless a hook is added and tested.

## Commands

```bash
node tools/cocos-graph/bin/cocos-graph.mjs build --project <project> [--bundle <bundle>] [--isolate]
node tools/cocos-graph/bin/cocos-graph.mjs build --project <project> --bundle <bundle> --live-json <snapshot.json> --isolate
node tools/cocos-graph/bin/cocos-graph.mjs query --project <project> --bundle <bundle> [--by-component <type>] [--by-script <uuid>] [--component-id <id>] [--path-glob <path>] [--text <q>] [--explain] [--limit 50] [--cursor 0] --isolate
node tools/cocos-graph/bin/cocos-graph.mjs resolve --project <project> --bundle <bundle> --handle <file#uuid> --isolate
node tools/cocos-graph/bin/cocos-graph.mjs resolve --project <project> --bundle <bundle> --uuid <engine-id> --isolate
node tools/cocos-graph/bin/cocos-graph.mjs navigate --project <project> --bundle <bundle> --handle <file#uuid> --relation ancestors|children|descendants [--depth 1] [--limit 50] --isolate
node tools/cocos-graph/bin/cocos-graph.mjs refs --project <project> --bundle <bundle> --asset-uuid <uuid> --isolate
node tools/cocos-graph/bin/cocos-graph.mjs validate --project <project> --bundle <bundle> --isolate
```

## Required mutation workflow

1. Search offline and keep `handle`, `uuid`, `file`, `source`, and `bundle`.
2. Reject/adapt when `stale.advisory=true`, `dirty` is `true` or `unknown`, `prefabOpaque=true`, or resolution is ambiguous.
3. Call `ccb2x.sceneInfo()` and `ccb2x.assetResolve({operation:"url_from_uuid"})` to verify the intended `.fire` is open.
4. Resolve/read the exact engine UUID live with `nodeQuery dump` or `componentQuery props`.
5. Perform the write through the narrow CC Bridge tool.
6. Read the changed target live and verify the observable result.
7. Only then record session continuity:

```bash
node tools/cocos-graph/bin/cocos-graph.mjs session-record \
  --project <project> --bundle <bundle> --scene-uuid <scene-uuid> \
  --working-path <path> --task <description> --verified
```

### Tool Selection Matrix

| Target Source | Tool to Read Structure | Tool to Inspect Properties | Live tree Allowed? |
|---|---|---|---|
| Open Scene (`sceneInfo` + `assetResolve` match) | `sceneSnapshot` | `nodeQuery dump` / `componentQuery props` | **YES** |
| Unopened `.fire` file | `cocos-graph navigate` or open via `sceneOpen` | `sceneOpen` then `nodeQuery dump` | **NO** |
| `.prefab` file on disk | `readPrefabJson` or `cocos-graph navigate` | `readPrefabJson` | **NO** |
| Composite handle (`file#uuid`) | Strip to bare `uuid` only after verifying `file` is open | `nodeQuery dump` with bare `uuid` | **NO** |

## Live snapshot contract

```json
{
  "sourceFile": "assets/<bundle>/<scene>.fire",
  "dirty": "unknown",
  "tree": { "children": [] }
}
```

Fetch via UTCP only: `sceneInfo` → `assetResolve url_from_uuid` → `sceneSnapshot({maxDepth:99,maxNodes:10000})`. Fail before publication when `budgetExhausted=true`, a node has no UUID, or `sourceFile` is not a unique `.fire` in the selected shard. Absent dirty becomes `"unknown"` — never coerce to `false`.

## Output and failure semantics

- Query results are deterministically ordered and cursor-paginated.
- Every handle includes `handle`, engine `uuid`, `file`, `source`, and `bundle`.
- `resolve --uuid` never guesses: one candidate resolves, duplicates return `ambiguous` plus candidates.
- `dirty:"unknown"` is advisory, never equivalent to clean.
- `prefabOpaque:true` means disk parsing omitted nodes/components without stable identity.
- Exit 0 + `total:0` means a valid empty result.
- Exit 2 means missing/stale/invalid data or bad arguments.
- Exit 3 means ambiguous bare identity.

## Do not

- Never cache or write T2 values from the graph.
- Never treat bare node UUID as global identity.
- Never use serialized positional `__id__` as identity.
- Never mutate from offline evidence without the live-read and post-write witness.
- Never dump an entire scene when a bounded query or navigation command answers the question.
- Never add SQLite, embeddings, or offline prefab expansion without measured need and correctness fixtures.
- Never import graph modules from Creator extension sources.
