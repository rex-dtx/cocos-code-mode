# Phase 1 — Surface Inventory and Baseline Evidence

## Recorded identities

| Item | Value |
|---|---|
| Extension implementation worktree | `G:/_ws/_helpers/cc-code-mode-cst-host-split` · `feat/ccb-host-split` |
| Extension source base | `0755e1bd40201d7860a0707e3ed8a16e57f58af1` |
| Extension `package.json` SHA-256 | `635ca798a612ea4181b2b1ce8c00103cf314e449c140f5ceb82236473806b942` |
| Extension lockfile | absent at source base; reproducible install/package work must add one before release |
| Gateway implementation worktree | `G:/_ws_me/atx-mcp-docs-ccb-protected-relay` · `feat/ccb-protected-logic-relay` |
| Gateway source base | `fd43c8b806dd2a67c76a2a863e92c5e2807fd648` |
| Gateway `package.json` SHA-256 | `f09ffb7db1cda7b9f6f83cc59a9385a1539a99e870785ddce39b42442742646d` |
| Gateway `yarn.lock` SHA-256 | `f3cbfc4fb12f6bdfe392eb7ced13ae985431031fefb2a7fb9c917b7e7a307051` |
| Host runtime | Node `v22.22.3`; npm `10.9.8`; Yarn `1.22.22` |
| Live Creator | Creator/engine `3.7.3`; project `G:/_ws/cc-fws/cc30-new-all-in-one` |
| Test-project commit | `e13c07352d92604ec7f43f1c3d78fa6c991f763d` |
| Test-project lock SHA-256 | `97afb61adddd586c453b87382142af2af1f3e7075832d6440117e13e322c474a` |
| Installed extension build | `2.0.0-dev.0483c4f`, commit `6ede24a`, branch `feat/ccb3x-consolidated`, clean |

The installed extension and implementation worktree intentionally differ. Baselines describe the live installed build; code changes start from the recorded implementation base. Creator project generated/config state was already dirty, but the open scene was clean before measurement.

## Surface freeze

`docs/protected-tool-classification.json` schema v2 contains exactly 86 explicit tool rows, 261 top-level input policies, 80 bounded output policies, eleven observation contracts, 86 per-operation effect policies, and 21 auxiliary route/middleware/storage/log/emission/package/UI/scene/panel/process rows. `scripts/audit-protected-surface.js` reconciles the tool ledger against live `/utcp`, every source `@utcpTool`, literal Express routes, named high-risk execution/process sinks, value provenance/transfer/effect rules, observation coverage, and the exact auxiliary-surface inventory. Manifest SHA-256: `02394f6d74be43844b3f1d87fc3406491fe08287ba05ed431aace4c8712ad8d3`.

| Disposition | Count |
|---|---:|
| `gateway-protected` | 47 |
| `local-public` | 33 |
| `internal-dev-only` | 2 |
| `removed` | 4 |

Intentional breaking removals:

- `executeJavascript`: arbitrary `new Function` in editor/scene contexts;
- `callComponentMethod`: caller-controlled method name;
- `bindButtonClickEvent`: caller-controlled handler name;
- `programManage`: mixed process launch and URL actions.

`runScriptDiagnostics` and `getScriptDiagnosticContext` become internal-development-only because they launch a local compiler process. `assetCreate` and `assetOperate` remain inspectable local-public tools because their current contracts include TypeScript-capable asset creation or unconstrained metadata; protected v1 accepts no arbitrary Gateway-authored text/blob/file content. README currently says 85 tools while the live manual, source decorators, and test contract contain 86; the generated ledger uses the observed 86-tool contract.

## Live measurements

Raw samples: [`evidence/phase-01/baseline.json`](evidence/phase-01/baseline.json). Timing uses Node `performance.now()` around real local HTTP calls.

| Scenario | Evidence |
|---|---|
| Manual discovery | 86 tools; 84,281-byte JSON manual |
| Small scene read | 20 samples; client p50 `1.39 ms`, p95 `2.30 ms`, p99 `2.76 ms`; 189 response bytes; one Creator IPC |
| Reversible mutation | create `15.50 ms`; delete `3.53 ms`; two snapshots; two undo calls restored `dirty=false` and zero temporary-node matches |
| 128×128 JPEG screenshot | 5 samples; p50 `17.27 ms`, p95/p99 `24.79 ms`; 3,526 response bytes; every sample valid JPEG; bytes stayed local |
| Ten-node read | ten calls `22.81 ms` versus one batch `7.96 ms`; `65.09%` wall-time improvement; ten results |
| Local development Gateway health RTT | 20 samples; p50 `2.29 ms`, p95 `3.81 ms`, p99 `4.00 ms` |

Cold DNS/TCP/TLS and healthy company-LAN measurements are not represented by localhost HTTP and remain Phase 5 release evidence. The Phase 1 numbers are implementation baselines, not release claims.

## Current confidentiality witness

The current build compiles all `source/**/*.ts` because `tsconfig.json` has no customer allowlist, emits inline source maps and inline sources, and packages all `dist` plus all `node_modules`. Exact recoverable paths include:

- `source/utcp/execute/execute-tool.ts` and `source/utcp/execute/*`;
- `source/scene.ts:runCode` and both `new Function` call sites;
- `source/utcp/tools/scene-tools.ts:callComponentMethod`;
- `source/utcp/tools/consolidated-tools.ts:programManage`;
- diagnostics `child_process.execFile` paths.

This proves the pre-cutover package is inspectable; it is not a confidentiality guarantee.

## Independent security review amendments

The pre-implementation security review returned no critical findings, five high findings, and five medium findings. Its Phase 2 verdict was initially no-go because the first ledger covered inputs/tools only and the protocol/release design left source-capable result/primitive values, idempotency crash semantics, signature bytes, release-policy mutability, route order, and owner-attestation claims underspecified.

Applied before Phase 1 re-review:

- bidirectional output provenance plus route/middleware/storage/log/emission/package inventory;
- protected v1 excludes arbitrary Gateway-authored text/blob/file values and source-capable asset/file primitives;
- exact-request handling precedes new nonce/sequence admission in one atomic transaction; sign-once durable exact-response replay and relay effect journal semantics are explicit;
- every operation has `none|local-state|project-write|external-side-effect`; every non-`none` variant is serialized, preconditioned, journaled, and never blindly retried;
- strict key/base64url/signature/media-type/domain byte table and verify-before-inner-parse order;
- externally signed immutable target metadata separated from online signed short-lived monotonic rollout policy;
- CCB raw cap/router before Gateway global JSON parsing; default-deny auth over every relay route; raw debug route/persistence removal;
- production EdDSA-only CC Bridge JWTs and signer-sidecar claims limited to custody/domain/rate isolation.

## Phase 1 acceptance

- [x] 86 live tools have explicit disposition and bidirectional input/output data policy.
- [x] Live and source registrations reconcile with no missing, dead, or duplicate tools.
- [x] Twenty-one auxiliary routes/middleware/storage/log/emission/package/UI/scene/panel/process surfaces have explicit cutover policy and high-risk sink discovery.
- [x] Generic code/method/handler/process/source-capable surfaces have exact deletion or typed-adapter targets.
- [x] Candidate primitives use only the finite Phase 2 vocabulary and protected values have provenance constraints.
- [x] Every operation has an explicit effect class; state/external effects have observation/precondition contracts.
- [x] Read, mutation, screenshot, ten-step, IPC/snapshot, bytes, and local Gateway timing have raw samples.
- [x] Independent security re-review approved the amended Phase 1 evidence and allowed Phase 2 protocol/fixture implementation to begin; Phase 3/4 remain gated on frozen Phase 2 fixtures.
