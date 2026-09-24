## 1. Proposal boundary

- [x] Create a separate pending R4 change rather than mutating the frozen `api-capability-resume` change.
- [x] Enumerate all six `replace` rows and state that implementation/qualification remains pending.
- [x] State explicit non-goals: no source edits, no portfolio/gate edits, and no native Creator 3.7.3 claim.

## 2. Replacement contracts

- [x] Define `prefabVariantCreate` as a bounded native prefab override/apply workflow with source/instance reload read-back; reject invented variant assets.
- [x] Define `tilemapCreate` as bounded TMX source generation/import/validation; separate source, import, and validation outcomes.
- [x] Define `tweenSequenceCreate` and `tweenSequenceInspect` as project-code composition/diagnostics, not native assets.
- [x] Define `tweenSequenceControl` as explicit live runtime-session control with observable state transitions.
- [x] Define `tweenSequenceValidate` as separated static diagnostics and optional runtime validation.

## 3. Evidence and promotion gate

- [x] Specify required positive and negative witnesses, clean artifact/build identity, fixture identity, route ownership, and persistence/reload or runtime read-back.
- [x] Require fail-closed behavior for unsupported native paths, invalid input, missing prerequisites, unknown identity, and unavailable evidence.
- [x] Keep every row `replace`/deferred until the route is implemented and independently evidenced; do not change portfolio states or thresholds in this change.
