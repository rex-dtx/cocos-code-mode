## Context

`api-capability-resume` records lane R4 as deferred because the portfolio concepts are not native Creator 3.7.3 capabilities. The portfolio already states the intended direction—prefab override/apply, external TMX workflow, and project-code tween workflow—but does not define enough boundary conditions for a later implementation review. This document makes those boundaries explicit without changing implementation or portfolio state.

## Design principles

1. **Native-versus-replacement honesty:** a replacement is useful only if its output and ownership are named. Generated project code, TMX source, and prefab overrides MUST NOT be represented as native assets that Creator does not provide.
2. **Bounded ownership:** each route has an explicit owner: Creator prefab workflow, TMX source/import pipeline, project code, or runtime session. Cross-owner hand-offs MUST be visible in the result.
3. **Evidence before promotion:** a design decision cannot qualify a row. Each route requires fresh positive and negative witnesses on the target artifact and Creator build.
4. **Fail closed:** unsupported native operations, missing sessions, unknown identities, malformed source, and unavailable read-back are errors, not inferred success.
5. **No accidental mutation:** design/inspect/validate routes are read-only unless a future implementation explicitly declares a write and proves its persistence boundary.

## Capability matrix

| Row | Proposed replacement | Primary owner | Required read-back | Native Creator 3.7.3 claim |
|---|---|---|---|---|
| `prefabVariantCreate` | prefab override/apply workflow | Creator prefab source + instance | reload and source/instance override diff | none |
| `tilemapCreate` | TMX generation/import/validation | TMX source + Creator importer | imported map/layer/object/tileset data | none |
| `tweenSequenceCreate` | project-code composition/diagnostics | project code | generated/updated representation and diagnostics | none |
| `tweenSequenceInspect` | project-code sequence diagnostics | project code | parsed descriptor/source locations | none |
| `tweenSequenceControl` | runtime control of project-code sequence | runtime session | live state after action | none |
| `tweenSequenceValidate` | static diagnostics + optional runtime validation | project code + runtime session | separated static/runtime results | none |

## Evidence model

Every future row implementation must emit an evidence record with:

- `capability`, replacement route, and contract version;
- exact Creator version/build and project/artifact commit or content hash;
- fixture identity and clean/dirty status;
- request inputs and bounded output summary;
- positive witness ID and observed postcondition;
- negative witness ID and deterministic error/postcondition;
- ownership classification (`native-creator`, `source-format`, `project-code`, or `runtime-session`);
- whether persistence/reload or runtime read-back was exercised.

A positive witness alone is insufficient. A native-looking output without ownership classification is invalid evidence.

## Row-specific acceptance sketches

### Prefab override/apply

Positive: modify a declared instance override, apply through the supported prefab workflow, reload, and observe the expected source/instance relationship and override diff. Negative: reject an unavailable variant operation, unresolved prefab identity, or unsupported target without writing an unrelated asset.

### TMX source generation/import/validation

Positive: generate a bounded valid TMX source, import it, and read back typed map/layer/object/tileset structure. Negative: malformed TMX, missing tileset/resource, or import failure must identify the failing boundary and MUST NOT be reported as successful map creation.

### Tween project-code composition/inspection

Positive: compose a deterministic bounded sequence representation and inspect the same representation with stable ordered steps and diagnostics. Negative: reject malformed sequence, unknown target, unsupported easing, missing code path, or non-inspectable representation. No native asset ID may appear as proof.

### Tween runtime control

Positive: with an explicit live session and sequence handle, issue a supported action and observe the corresponding runtime state transition. Negative: missing session, unknown handle, unsupported action, or stale session must fail closed. Static source output is not runtime evidence.

### Tween validation

Positive: return distinct static-valid and (when requested) runtime-valid results with observable evidence. Negative: distinguish schema/reference/parse errors from unavailable runtime context; never collapse them into native editor support.

## Review gates

Before moving any portfolio row:

- contract review confirms the replacement preserves the boundaries in `proposal.md`;
- implementation review confirms no native Creator 3.7.3 claim is introduced;
- evidence review confirms fresh positive and negative IDs, clean artifact/build identity, and required read-back;
- portfolio review confirms the state change is explicit and does not alter unrelated rows or thresholds.

If any gate is missing, keep the row `replace`/deferred and record the blocker rather than weakening the contract.
