## Purpose

Lưu kho toàn bộ API capability chưa xong để sau publish có thể resume mà không mất bối cảnh. Change này ở trạng thái **pending** — mọi requirement là `SHOULD` (khuyến nghị khi quay lại), không phải `MUST` cho lane publish hiện tại.

## ADDED Requirements

### Requirement: Resume marker is pending and traceable

The `api-capability-resume` change SHOULD remain `status: pending` with `freeze.commit: bacd213` until the owner reopens a lane. It SHOULD NOT modify `docs/tool-portfolio-candidates.json` states or `scripts/audit-tool-portfolio.js` thresholds while pending. Evidence snapshot (`tool-portfolio-candidates.json`, `api-capability-probe-20260920.json`, `preview-disabled-reconciliation-20260920.json`, `next-update-3x8-capability-backlog.json`) SHOULD be hash-referenced, not duplicated.

#### Scenario: Visualizing the pending resume

- **WHEN** a viewer opens `openspec/changes/api-capability-resume/`
- **THEN** they see `proposal.md` Goal frozen verbatim, 11 pending + 23 rejected counts, and a pointer to `bacd213` smoke `10/10 pass` on `2026-09-21`.

### Requirement: Lane decomposition for re-entry

Deferred capabilities SHOULD be grouped into lanes R1–R5 as defined in `tasks.md` (R1 preview runtime, R2 project/globals, R3 bundle verification, R4 replace redesign, R5 engine features). Each lane SHOULD become its own proposal/spec when reopened, carrying its rows' `witnessContractIds`, `positiveTestID/negativeTestID`, and `fixtureID`.

#### Scenario: Reopening a lane

- **WHEN** the owner says "back lại lane R2"
- **THEN** the agent creates a new change from lane R2's rows, runs a fresh live probe on a non-dirty artifact, and promotes only rows with both `positiveTestID` and `negativeTestID` evidence.

### Requirement: No silent gate changes

Any change to `requiredApprovalCount` (currently frozen at 82, `audit-tool-portfolio.js:16`) or to `potentiallyQualifiable` denominator SHOULD be recorded as a decision file alongside the promoting commit, not by editing the threshold quietly.

#### Scenario: Bumping the gate

- **WHEN** a lane promotion raises `potentiallyQualifiable` from 73
- **THEN** the commit includes a `reports/decision-*.json` or `docs/adr/*.md` explaining why the gate moved.

### Requirement: Owner goal is preserved

The owner goal — "mở rộng API đến mức vừa đủ dùng để agent thao tác với các components của editor nhanh nhất có thể, rồi ngưng để làm build/security → publish/release, sau đó mở lại" — SHOULD be quoted verbatim in `proposal.md` Goal and remain the acceptance criterion for closing the resume.

#### Scenario: Closing the resume

- **WHEN** all lanes the owner selected are qualified on Creator ≥3.8.0 with live witnesses
- **THEN** `api-capability-resume` MAY be archived as `done` and its rows removed from `rejected/candidate/replace`.

### Requirement: Evidence retention

Original probe evidence (`api-capability-probe-20260920.json: result "Message does not exist"`, `preview-disabled-reconciliation`, `next-update-3x8-backlog`) SHOULD remain the source of truth for why each row was not promoted on 3.7.3, until a new probe overwrites it. No filesystem fallback for editor-owned state.

#### Scenario: Challenging a rejection

- **WHEN** someone proposes to qualify `physics2dConfigure` on 3.7.3 without a new probe
- **THEN** the requirement fails review — only a fresh IPC live witness on a non-dirty build can overturn the verdict.
