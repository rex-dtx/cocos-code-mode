## Why

UI layout failures in Cocos scenes are currently difficult to diagnose from tool output: callers can inspect or mutate individual properties, but cannot obtain one bounded, read-only report that explains live transform geometry, viewport fit, clipping, and actionable anomalies. A high-level report enables reliable 2D UI qualification now while preserving the existing low-level helper contracts and leaving 3D layout for a later capability.

## What Changes

- Add a high-level read-only layout-report helper, `uiLayoutReport`, that composes the shared live geometry engine rather than replacing existing helpers.
- Accept a Canvas or subtree root, design resolution, fit mode, current viewport, and explicit output limits; report the resolved root and bounded UI-node inventory in JSON by default.
- For each included UI node, report UUID/path, active state, sibling index, component inventory, local transform, live world matrix and four world-space corners, design-space and screen-space AABBs, anchor, and size.
- Evaluate Widget, Layout, Mask, and ScrollView constraints and emit stable issue codes, severity, and evidence for off-screen content, clipping, zero/negative size, anchor anomalies, near-alignment, and gap inconsistency; include overlap as advisory only.
- Keep inactive nodes in inventory while suppressing default geometry issues for them; exclude non-UI nodes from UI findings and avoid false positives caused by non-UI descendants.
- Support an optional visual overlay that is ephemeral and preserves scene dirty state; JSON remains the default response format.
- Define deterministic invalid-root errors, bounded truncation with `complete: false`, and explicit geometry semantics based on actual live Cocos transforms (never editor-dump position summation).

## Capabilities

### New Capabilities

- `ui-layout-report`: High-level, bounded, read-only 2D UI layout diagnostics with optional non-mutating overlay.

### Modified Capabilities

- None. Existing `uiLayoutInspect`, `uiLayoutValidate`, and `uiLayoutApply` contracts remain public, qualified, and unchanged.
