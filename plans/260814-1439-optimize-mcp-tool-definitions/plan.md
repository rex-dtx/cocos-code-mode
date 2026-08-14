# Optimize MCP Tool Definitions (Request-Side Token Cost)

## Context

MCP tool definitions are sent as part of Claude's `tools[]` parameter on **every API call** in a conversation. With 61 registered tools, this is a fixed per-turn overhead that multiplies across the session. Debug logging (`77bbfa9`) now provides visibility into actual payloads. This plan targets reducing the static token cost of tool schemas and descriptions.

Related: `260814-1424-optimize-mcp-response-payload` (response-side optimization).

## Baseline Measurements

Static analysis of 55 parseable tools:
- Descriptions total: ~11,485 chars ≈ 2,871 tokens
- Schemas (inputs+outputs): ~32,236 chars ≈ 8,059 tokens (measured on 40/61; rest use imported schema objects — real total likely 10-12K tokens)
- **Estimated total: ~11K-14K tokens per API call**
- Top verbose descriptions: `editorIntrospect` (824), `animationQuery` (573), `animationEdit` (547), `materialQuery` (400), `editorListTypes` (399)

Need exact manual size via `/utcp` endpoint measurement to confirm.

## Optimization Phases

### Phase 1: Trim Outputs Schemas (Low Risk, High Impact)

Outputs schemas (~8K+ tokens) serve documentation/validation purposes but are not strictly required for Claude to call tools correctly. Most outputs schemas define full nested object shapes that add significant size without improving call accuracy.

**Changes:**
- Audit each tool's outputs schema in `source/utcp/tools/*.ts`
- Reduce to top-level keys only (e.g., `{ type: 'object', properties: { success: {}, reference: {} } }` instead of full nested shape)
- Check whether code-mode MCP validates output against schema — if yes, keep minimal valid schema; if no, can strip further
- Target: reduce outputs schema section by 60-80%

**Expected savings:** ~5-8K tokens per API call

### Phase 2: Compress Descriptions (Low Risk, Medium Impact)

Average description is 209 chars; several exceed 400 chars with usage guidance embedded ("If you only have the scene path, resolve its uuid first..."). These instructional details belong in system prompts or docs, not in per-tool descriptions.

**Changes:**
- Rewrite descriptions for top-10 longest tools to ~80-120 chars
- Remove cross-references to other tools from descriptions (Claude has all tools visible)
- Keep: what it does + key constraint. Drop: how to use it, when to prefer over X
- Standardize pattern: `<verb> <target>. <one-line context if needed>`

**Expected savings:** ~1-1.5K tokens per API call

### Phase 3: Consolidate Similar Tools (Medium Risk, Medium-High Impact)

61 tools creates selection overhead for Claude and bloats the manual. Several domains have overlapping tools that could be merged with an action discriminator param.

**Candidate consolidations:**
| Current | Merge Into | Notes |
|---|---|---|
| `sceneOpen`, `editorOperate(save/close)` | `sceneManage(action)` | Action param: open/save/close |
| `editorIntrospect`, `editorListTypes` | `editorQuery(type)` | Query type discriminator |
| `inspectorGetProperties`, `inspectorGetSettingsProperties` | `inspectorGet(target)` | Unified target param |
| `nodeComponentAdd`, `nodeComponentRemove` | `nodeComponent(action)` | Action param |

**Risk:** Breaks existing workflows relying on specific tool names. Requires prompt migration. Should follow baseline data collection to identify which tools are actually called frequently vs rarely.

**Expected savings:** ~2-4K tokens per API call (fewer tools = smaller manual)

### Phase 4: Lazy-Load Tool Groups (High Risk, Highest Impact)

Only expose tool schemas relevant to current task context. Requires architectural change in both extension and code-mode MCP client.

**Approach options:**
- Tag-based grouping: register all tools with tags, expose only matching group
- Session-scoped: detect active workflow (scene editing vs asset management vs build) and swap tool sets
- Progressive disclosure: start with core tools, expand on request

**Risk:** Requires code-mode MCP changes. May confuse Claude if tools appear/disappear mid-session. Spike first before committing.

**Expected savings:** ~8K+ tokens per API call when narrowed to one domain

## Success Metrics

Before/after comparison via:
- `/utcp` endpoint response size (bytes) — direct measure of manual size
- Token count estimate (manual bytes / 4) per API call
- Number of tools registered (before: 61)

Target: **50%+ reduction in manual token cost** after Phase 1+2.

## Dependencies

- Debug logging feature (done: `77bbfa9`)
- Baseline measurement: fetch `/utcp` manually, capture exact byte count
- Related plan: `260814-1424-optimize-mcp-response-payload` (independent, can run in parallel)

## Risks

- Phase 1: code-mode may validate outputs → must check SDK behavior first
- Phase 2: Over-compressed descriptions hurt tool selection accuracy → test with Claude
- Phase 3: Breaking change for existing prompts/workflows → deprecation period
- Phase 4: Architectural risk, requires spike validation before commitment

## Open Questions

1. Does code-mode MCP validate tool outputs against the schema? Determines how aggressively Phase 1 can trim.
2. Which of the 61 tools are actually called most frequently? Data-driven consolidation needs debug log analysis first.
3. Should Phase 1 and Phase 2 be combined into a single commit since both touch same files?
4. Is there a way to A/B test trimmed descriptions without deploying a new extension version?
