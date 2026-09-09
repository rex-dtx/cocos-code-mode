## Context

The existing tool surface already exposes qualified `uiLayoutInspect`, `uiLayoutValidate`, and `uiLayoutApply`; those contracts are compatibility boundaries. This change adds one read-only high-level capability in a Cocos Creator 3.7 extension, with 2D UI as the current scope. Runtime node transforms are authoritative, and all output must stay bounded for tool transport.

## Goals / Non-Goals

**Goals:**

- Build one shared geometry/constraint evaluation path that can compose existing inspection behavior without changing established helpers.
- Produce deterministic JSON suitable for agents and automation, with an optional ephemeral visualization.
- Correctly map local UI geometry through the live scene graph into design and screen spaces, including fit mode, scale, rotation, anchors, masks, and scrolling.
- Make issue severity, evidence, errors, and truncation explicit and testable.

**Non-Goals:**

- 3D layout analysis, perspective projection, or 3D nodes as a new diagnostic domain.
- Replacing or deprecating any existing layout helper.
- Applying layout corrections, persisting overlay nodes/assets, or changing serialized scene data.
- Treating overlap as a hard validation failure.

## Decisions

1. **Public operation and response.** Add `uiLayoutReport` as a distinct read-only operation. Its request identifies a root (Canvas or subtree), design resolution, fit mode, viewport, and explicit limits; `overlay` is opt-in. JSON is the canonical response and includes `complete`, report metadata, nodes, issues, truncation details, and overlay status.
2. **Geometry source of truth.** Resolve the live Cocos node/component objects and use their runtime transform/world-matrix APIs. Compute each UI rectangle's four corners from its local content rectangle and anchor, transform through the live world matrix, then map through the resolved design-to-screen fit transform. AABB values are the min/max of the transformed corners; do not reconstruct world coordinates by adding editor positions.
3. **Traversal and identity.** Traverse only the selected root's descendants, retaining deterministic pre-order/path and sibling indices. Identify UI-bearing nodes by supported UI components (including Widget, Layout, Mask, and ScrollView relationships); ordinary nodes remain traversal barriers/context as needed but cannot generate UI findings. Keep inactive UI entries for inventory while gating normal issue evaluation on active state.
4. **Constraint evaluation.** Run geometry checks after transforms and fit mapping, then evaluate Widget/Layout constraints against their resolved runtime values. Evaluate clipping against effective Mask and ScrollView viewports, and report anchor/size anomalies with stable codes. Near-alignment and gap inconsistency are diagnostics with evidence and configurable tolerances. Overlap is emitted only as an advisory relationship.
5. **Bounds and errors.** Enforce node, issue, and response-size limits before serialization. Any omitted eligible content records a truncation reason and sets `complete: false`. Root resolution/type errors use stable structured error codes and never return misleading partial success.
6. **Overlay lifecycle and artifact.** Render the bounded report primitives into an owned offscreen canvas, including node polygons and issue markers, and encode the result as a bounded PNG payload in the JSON response. The canvas is never attached to the persisted scene hierarchy or serialized assets; its backing store is released and any accidental attachment is removed in a finally path. The response records MIME, encoding, decoded byte length, raster dimensions, source counts, effective artifact/response byte limits, validity, and cleanup. If visualization or encoding is unavailable, or the payload would exceed either byte limit, preserve the JSON report and expose a stable overlay error without an artifact or false success.
7. **Compatibility.** Share internal geometry primitives only where this avoids divergent calculations; keep the three existing public helper registrations, schemas, and behavior untouched. Add focused live coverage for transforms, filtering, bounds, root errors, overlay validity, and dirty-state preservation.

## Risks / Trade-offs

- Creator runtime APIs differ across node/component versions; capability detection and structured unsupported-field evidence are safer than assuming editor serialization shape.
- World-corner and clipping calculations cost more than position-only checks, so limits and deterministic early termination are required.
- Editor overlay APIs may be unavailable in headless/live contexts; explicit overlay status prevents false success while keeping JSON useful.
- Tolerance-based near-alignment/gap diagnostics can be noisy; expose effective tolerances in report metadata/evidence and keep these findings non-mutating advisory diagnostics unless a clear constraint is violated.
