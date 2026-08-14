# Optimize MCP Response Payload Size

## Context

MCP tools return verbose JSON responses that consume excessive LLM context tokens. Debug logging (`feat: add debug logging toggle`) now provides full visibility into request/response payloads and sizes. This plan targets reducing response payload size at the tool level.

## Problem Analysis

Three layers of serialization occur per tool call:
1. Tool returns object → `res.json(result)` stringifies once (correct)
2. MCP client receives JSON → parses back to object
3. MCP protocol wraps into `tool_result` message → stringifies again (protocol requirement)

The bottleneck is NOT double-stringification — it's **verbose data objects**. Key offenders identified from code review:

| Tool | Return Shape | Issue |
|---|---|---|
| `inspectorGetProperties` | `{ dump: parsedProps }` | Full property tree for node/component/asset; complex nodes = hundreds of props |
| `inspectorGetInstanceDefinition` | `{ definition: string }` | Long TS definition strings for large classes |
| `sceneGetNodeTree` / `query-node-tree` | Full scene tree | Recursive children with all metadata |
| `assetGetTree` | Asset database tree | Full directory listing |
| Material query tools | Raw editor API results | Unfiltered Cocos internal structures |

`unwrapProperties()` in `tools-utils.ts:143` recursively unwraps ALL properties including metadata that LLM doesn't need (tooltip, displayName, extends chains, decorator info).

## Optimization Strategy

### Phase 1: Response Trimming Middleware (Low Risk, High Impact)

Add a post-processing step in the UTCP server handler that strips unnecessary fields before `res.json()`.

**Changes:**
- Create `source/utcp/utils/response-trimmer.ts` — configurable field stripper
- Strip keys: `null`, `undefined`, empty arrays `[]`, empty objects `{}`
- Configurable whitelist/blacklist per tool name
- Integrate into handler in `utcp-server.ts` between tool execution and `res.json()`

**Expected reduction:** ~15-30% across all tools

### Phase 2: Selective Property Inspection (Medium Risk, Highest Impact)

Add optional `fields` parameter to `inspectorGetProperties` so callers request only needed properties instead of full dump.

**Changes:**
- Add `fields?: string[]` param to `inspectorGetProperties` tool definition
- Modify `unwrapProperties()` to accept field filter
- When `fields` provided: only unwrap specified top-level keys
- Default behavior unchanged when `fields` omitted (backward compatible)

**Expected reduction:** 50-80% for node inspection calls (the most frequent heavy calls)

### Phase 3: Definition Pagination (Low Risk, Medium Impact)

Split long TypeScript definitions into chunks for `inspectorGetInstanceDefinition`.

**Changes:**
- Add `section?: string` param to request specific class/interface section
- Return `{ definition, totalSections, sections: string[] }` for discovery
- Cache definitions in-memory (already partially done via `_definitions` array)

**Expected reduction:** 40-60% per call when requesting single section

### Phase 4: Scene Tree Pruning (Medium Risk, High Impact)

Add depth limit and field selection for scene tree queries.

**Changes:**
- Add `maxDepth?: number` param to tree-returning tools
- Add `fields?: string[]` to select which node properties to include
- Default maxDepth=3 (covers most use cases without full recursive dump)

**Expected reduction:** 60-90% for scene tree operations

## Success Metrics

Measure via debug logs (`/debug-logs?tool=X`) before/after each phase:
- Average response size per tool (bytes)
- Top-10 heaviest tools by `size` field
- Total payload per session (sum of all response sizes)

Target: **50%+ average reduction** across all tool responses after Phase 1+2.

## Dependencies

- Debug logging feature (done: commit `77bbfa9`)
- Baseline measurements: run debug mode, collect logs, identify top offenders with real data

## Risks

- Phase 2 changes tool interface → MCP clients may need update if they pass `fields` param
- Phase 4 default depth change could break existing workflows relying on full trees → make opt-in first
- Stripping null/empty values might remove semantically meaningful absences → document stripped fields

## Open Questions

1. Should Phase 1 stripping be opt-in per-tool or global default?
2. For Phase 2, should we also support dot-notation paths (`position.x`, `__comps__.0.type`) for nested field selection?
3. Should we add a `/debug-stats` endpoint that aggregates log data (avg size per tool, top-N heaviest) automatically?
