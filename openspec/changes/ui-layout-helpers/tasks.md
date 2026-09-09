## 1. Contract and shared geometry foundation
- [x] 1.1 Inventory the existing `uiLayoutInspect`, `uiLayoutValidate`, and `uiLayoutApply` registrations, schemas, handlers, and qualified tests; record compatibility assertions before introducing shared code (verify: each existing helper remains independently callable with its current observable contract).
- [x] 1.2 Define the bounded `uiLayoutReport` request/response schema, stable error and issue codes, severity vocabulary, truncation metadata, and overlay status fields (verify: schema rejects invalid roots/limits deterministically and accepts JSON-default plus explicit overlay requests).
- [x] 1.3 Implement shared live-transform geometry primitives for local rectangles, anchors, world matrices, four corners, design-to-screen fit mapping, and AABBs (verify: focused live cases with scale, rotation, anchor, and viewport fit produce mathematically consistent corners and AABBs).

## 2. Read-only report traversal and diagnostics

- [x] 2.1 Resolve Canvas or subtree roots and traverse descendants deterministically, collecting UUID/path/active/sibling/components and filtering non-UI nodes without mutating the scene (verify: mixed UI/non-UI hierarchy reports only UI geometry findings and invalid/non-UI roots return the stable structured error).
- [x] 2.2 Add runtime evaluations for Widget, Layout, Mask, and ScrollView constraints, clipping, off-screen bounds, zero/negative size, anchor anomalies, near-alignment, and gap inconsistency with evidence-bearing issue entries (verify: focused live fixtures exercise each issue family and confirm inactive inventory entries suppress default geometry findings).
- [x] 2.3 Add overlap-pair detection as an advisory-only finding and expose effective tolerances/constraint context in report metadata or evidence (verify: overlap without another violation never becomes a blocking severity).
- [x] 2.4 Enforce node, issue, and serialized-response limits, including deterministic truncation reasons and `complete: false` (verify: each configured limit yields valid bounded JSON with explicit truncation metadata and no silent omission).

## 3. Optional overlay and integration

- [x] 3.1 Implement the opt-in transient overlay using the report's bounded geometry, with explicit validity/failure status and guaranteed cleanup (verify: valid overlay request visualizes the selected geometry; unavailable overlay returns a valid JSON report with explicit failure status).
- [x] 3.2 Preserve scene dirty/modified state and serialized scene content across overlay creation, update, failure, and cleanup (verify: focused live overlay test snapshots dirty state/content before and after and observes no persistent scene mutation).
- [x] 3.3 Register and expose `uiLayoutReport` without deleting, aliasing, renaming, or changing the three existing layout helpers (verify: tool discovery shows the new helper and compatibility smoke calls show all four expected operations).

## 4. Focused verification and release evidence

- [x] 4.1 Add focused live tests for scale/rotation/anchor geometry, non-UI filtering, truncation, invalid root, overlay validity, and dirty-state preservation (verify: the focused live suite passes against a live Cocos runtime and captures both positive and failure evidence).
- [x] 4.2 Run the affected unit/build checks and the relevant live suite, then inspect the generated tool/schema output for the new operation and unchanged existing contracts (verify: unit/build/live results are recorded with the same declared build and no unrelated source or generated files are changed).
- [x] 4.3 Perform a final boundedness/compatibility review against `specs/ui-layout-report/spec.md` and `design.md` before handoff (verify: every requirement has an observable implementation or test witness, with 3D explicitly out of scope).
