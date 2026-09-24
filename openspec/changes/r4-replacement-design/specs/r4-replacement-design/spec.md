## Purpose

Define bounded replacement contracts for the deferred R4 API capability rows without claiming native Creator 3.7.3 support or changing portfolio state.

## ADDED Requirements

### Requirement: R4 remains documentation-only and pending

The R4 change MUST remain `status: pending` until implementation and qualification evidence is reviewed. It MUST NOT modify source code, `docs/tool-portfolio-candidates.json`, portfolio denominators, or approval thresholds.

#### Scenario: Reviewing the reopened lane

- **WHEN** a reviewer opens this change
- **THEN** the reviewer can identify all six R4 rows, their replacement owner, their non-goals, and the fact that no row is implemented or qualified by this proposal

### Requirement: Prefab variant replacement is an override/apply workflow

A future `prefabVariantCreate` implementation MUST describe and evidence a native prefab override/apply workflow over an existing prefab source and instance. It MUST NOT claim that Creator 3.7.3 creates a separate native prefab-variant asset.

#### Scenario: Prefab route is proven

- **WHEN** an implementation applies a bounded override and reloads the fixture
- **THEN** evidence includes source/instance identity, applied override data, reload read-back, and positive/negative witness IDs; otherwise the row remains `replace`

### Requirement: Tilemap creation replacement is bounded TMX source/import/validation

A future `tilemapCreate` implementation MUST separate TMX source generation, Creator import, and imported-data validation. It MUST NOT claim native Creator tilemap authoring.

#### Scenario: TMX import boundary fails

- **WHEN** source is malformed or a referenced tileset/resource is unavailable
- **THEN** the response identifies the failed boundary, reports deterministic failure, and provides no successful native-creation claim

### Requirement: Tween replacements target project code and runtime diagnostics

Future implementations MUST treat `tweenSequenceCreate` and `tweenSequenceInspect` as project-code composition/inspection, `tweenSequenceControl` as explicit live runtime-session control, and `tweenSequenceValidate` as separated static diagnostics plus optional runtime validation. None may claim a native tween sequence asset.

#### Scenario: Static tween data is mistaken for runtime proof

- **WHEN** a sequence parses successfully but no live runtime session is available
- **THEN** create/inspect may report project-code diagnostics, while control/runtime validation reports unavailable runtime evidence and does not claim success

### Requirement: Every promotion requires positive and negative evidence

Before any R4 row can change portfolio state, evidence MUST identify the exact Creator version/build, clean artifact identity, fixture, route ownership, positive witness, negative witness, and persistence/reload or runtime read-back required by that route. Unsupported or unproven routes MUST remain `replace`/deferred.

#### Scenario: Positive-only implementation

- **WHEN** a route has a positive result but no deterministic negative witness or required read-back
- **THEN** the row remains pending and no portfolio state or gate is changed

### Requirement: Fail closed and preserve non-goals

R4 replacement routes MUST fail closed for unsupported native operations, invalid inputs, missing prerequisites, unknown identities, unavailable read-back, and ambiguous ownership. They MUST NOT silently mutate unrelated project/editor state.

#### Scenario: Native capability cannot be proven

- **WHEN** Creator 3.7.3 lacks the claimed native route or the route cannot be evidenced
- **THEN** documentation records the route as proposal-only and the portfolio remains unchanged
