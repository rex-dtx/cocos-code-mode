## Purpose

Provide a bounded, read-only diagnostic view of a Cocos 2D UI subtree so callers can understand live transforms, viewport fitting, constraints, and layout anomalies without mutating the scene.

## ADDED Requirements

### Requirement: Report live 2D layout geometry

The `uiLayoutReport` capability MUST accept a Canvas or subtree root and return JSON by default. It MUST use the runtime's actual world transforms, including scale, rotation, skew, parent transforms, and anchor behavior, rather than summing positions from serialized editor data. The report MUST include design resolution, fit mode, current viewport, root identity, and a deterministic bounded node list.

#### Scenario: Scaled and rotated hierarchy
- **WHEN** a rooted UI hierarchy contains non-unit parent scale and a rotated child
- **THEN** the child entry includes its local transform, complete live world matrix, four transformed world-space corners, and design-space and screen-space AABBs derived from those corners

#### Scenario: Viewport fitting
- **WHEN** a design resolution and current viewport are supplied with a supported fit mode
- **THEN** the report exposes the resolved scale and offset used to map design coordinates to screen coordinates, and screen-space geometry reflects that mapping

### Requirement: Identify UI nodes and preserve inventory context

Each reported node MUST include UUID, stable hierarchy path, active state, sibling index, component inventory, local transform, anchor, and size. The traversal MUST include recognized UI nodes and MUST NOT produce UI findings for non-UI nodes. Inactive nodes MUST remain visible in inventory but MUST NOT receive default geometry issues solely because they are inactive.

#### Scenario: Non-UI descendants
- **WHEN** the subtree contains ordinary scene nodes mixed with UI nodes
- **THEN** ordinary nodes are excluded from UI geometry findings and do not cause false-positive layout issues for their UI relatives

#### Scenario: Inactive UI node
- **WHEN** an inactive UI node is inside the selected root and has an off-screen or zero-size geometry
- **THEN** it appears with `active: false`, while default geometry issue evaluation is suppressed for that node

### Requirement: Evaluate constraints and emit actionable issues

The report MUST evaluate applicable Widget, Layout, Mask, and ScrollView constraints. Issues MUST use stable issue codes, severity, and machine-readable evidence identifying the affected node and relevant bounds/constraint values. It MUST support findings for off-screen content, clipping, zero or negative size, anchor anomalies, near-alignment, and gap inconsistency. Overlap MUST be advisory and MUST NOT be elevated to an error or warning solely because rectangles intersect.

#### Scenario: Constraint and bounds violations
- **WHEN** an active UI node is outside the screen, clipped by a relevant ancestor, has non-positive size, or violates an applicable Widget/Layout/Mask/ScrollView constraint
- **THEN** the report emits the corresponding issue code with severity and evidence containing enough geometry or constraint data to explain the finding

#### Scenario: Advisory overlap
- **WHEN** two active UI elements overlap without another violated constraint
- **THEN** the report may emit an overlap advisory with pair identity and intersection evidence, but MUST NOT classify overlap alone as a blocking issue

### Requirement: Bound output and report errors deterministically

The helper MUST accept explicit limits for nodes, issues, and serialized output or equivalent bounded controls. When any limit truncates traversal or findings, the report MUST set `complete: false` and include truncation metadata; it MUST never silently omit entries. An invalid, missing, or non-UI root MUST return a deterministic structured error rather than a partial successful report.

#### Scenario: Truncated report
- **WHEN** a configured limit is reached before all eligible nodes or findings are emitted
- **THEN** the JSON response contains `complete: false`, identifies the limit/reason, and remains valid JSON

#### Scenario: Invalid root
- **WHEN** the requested root UUID/path does not resolve to a live node or is not a Canvas/UI subtree root
- **THEN** the helper returns a stable error code and explanatory evidence, without mutating the scene

### Requirement: Optional overlay is ephemeral and non-dirtying

The JSON report MUST be the default response. An optional overlay MAY visualize reported bounds and issue locations in the editor/runtime surface, but it MUST be explicitly requested, remain ephemeral, and preserve the scene's dirty/modified state and serialized scene content. When available, the response MUST include a directly consumable bounded PNG artifact with its MIME type, base64 encoding, decoded byte length, raster dimensions, and source node/issue counts. The response MUST include the effective artifact and serialized-response byte limits. The artifact MUST be omitted and `valid` MUST be false when either limit is exceeded or PNG encoding is unavailable.

#### Scenario: Overlay requested on a valid root
- **WHEN** a caller requests an overlay together with a valid report
- **THEN** the response identifies the overlay lifecycle/validity, includes a bounded PNG artifact representing the same reported geometry and issue locations, and the scene dirty state before and after the call is unchanged

#### Scenario: Overlay failure or cleanup
- **WHEN** overlay creation is unavailable, encoding fails, a byte limit is exceeded, or cleanup is requested
- **THEN** the JSON response remains valid, reports overlay validity/failure explicitly with a stable error code, and leaves no persistent scene mutation or dirty-state change

### Requirement: Preserve existing layout helper contracts

Introducing `uiLayoutReport` MUST NOT remove, rename, alias, or change the observable behavior or qualified contracts of `uiLayoutInspect`, `uiLayoutValidate`, or `uiLayoutApply`.

#### Scenario: Existing helper compatibility
- **WHEN** existing callers invoke any of the three established helpers
- **THEN** they continue to receive their previously qualified behavior and contracts independently of the new high-level report
