# Prompt Guidance — Risks & Trade-offs

Applies to: `README.md` → Agent Prompt Guidance snippet for `cc_bridge_2x.*` / `ccb_2x.*` (manual `cc-bridge-2x`/`ccb-2x`, mirrored from `cc3x7`).

## The snippet

```text
When returning data from cc_bridge_2x / ccb_2x tools (manual cc-bridge-2x/ccb-2x):
- Return stats/aggregates (counts, top-N) unless the question needs items.
- User asks list/find/which/show → return capped list with .slice(0, N), not count.
- Drop empty arrays/objects and deep subtrees a summary already answers.
- Keep uuid for any node you may operate on in a next step (verbs: set/add/remove/destroy).
- If an aggregate looks anomalous (large branch, mixed active, errors), drill into that branch before concluding.
```

## Failure modes

### 1. Lost uuid when mutation follows aggregation — highest risk

Agent must predict chain; turn 1 aggregates, turn 2 wants `nodeSetProperty` but has no uuid → extra round-trip.

- Impact: +1 hop, ~0.5k tok. Still cheaper than retaining raw tree.
- Mitigation: explicit verb list, keep on any planned mutate.

### 2. Summary hides target item — medium risk

`stats/top-N` + `.slice(0, N)` can miss target at N+1 for exploratory queries.

- Mitigation: `list/find/which/show` bypass aggregation.

### 3. Dropped defaults misinterpreted — low (fixed)

Early draft dropped `active:true` ("missing = true"); after `/compact` agent forgets convention. Fixed: only empty containers/subtrees dropped.

### 4. Anomalous branch not drilled — low risk

Triggers: branch > 20 children, `active:false` present, has errors.

## Net trade-off

Typically -50 to -80% response tokens. Worst case +1 re-query, still net negative. Rollback is prompt-only.

## Differences vs cc3x7

- 2x uses `uuid` (not `reference`/`instance`); snippet says `uuid`.
- 2x `nodeQuery dump` already omits `types` by default — agent-side trimming is the extra saving (empty arrays/objects via `response-trimmer`).
