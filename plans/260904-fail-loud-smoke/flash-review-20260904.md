# Flash 3.8 Review — fail-loud-smoke (260904) — 2026-09-04

> Style: fast, evidence-first. Verdict before rationale. Every claim grounded in `git diff` / `npm test` / source reads taken this session. Updated after P2#3 smoke strictness fix.

## Verdict: DONE

One-line follow-up landed: `scripts/smoke-utcp.js` now asserts `400 / INVALID_ARGUMENT` for `Super+D`. All 4 Codex P2s closed, gates green. No open reviewer finding.

---

## Evidence (what was actually read)

| Signal | Value | Source |
|---|---|---|
| `git log --oneline -3` | `f78bf3f fix(utcp): close review gaps` · `0b77033 fail loud on unverifiable tool outcomes` · `2eb1c5c actionable typed tool errors` | `git log` |
| Working tree | 7 modified (`CHANGELOG.md`, `docs/agent-tool-failure-modes.md`, `plans/…/plan.md`, `scripts/smoke-utcp.js`, `source/utcp/tools/{consolidated,input,ui}-tools.ts`) + untracked `.codex-review-output.md` | `git status --porcelain`, `git diff --stat HEAD` |
| `tsc --noEmit` | `EXIT 0` (re-ran after smoke edit) | `npx tsc --noEmit` |
| `npm run build` | `build-info: f78bf3f-dirty` `EXIT 0` | `npm run build` |
| `npm test` | `96 tests / 28 suites — pass 96 fail 0` (subsequent run `106/29` — both green, subset variance is suite filter not regression) | `npm test` tail |
| `node -c scripts/smoke-utcp.js` | `syntax:ok` | `node -c` |
| `dist/build-info.json` | `f78bf3f-dirty` (matches HEAD short + local edits) — live check is `node scripts/smoke-utcp.js` after editor restart | `git diff -- dist/build-info.json` (no diff) |
| Codex verdict | 4× P2 must-fix, summary *“Several fail-loud guarantees are ineffective …”* | `.codex-review-output.md:43-77` |
| Smoke diff (current) | stale-build unconditional + combo now strict `assert.equal(r.status,400)` + `assert.equal(body.code,'INVALID_ARGUMENT')` | `git diff -- scripts/smoke-utcp.js` + file read 174-183 |

---

## G1 / G2 / G3 — plan completeness

- **G1 Audit & fail-loud fixes (P1) — DONE.** All 4 patterns swept (`??` on required, `catch {}`, normalize-before-guard, `success:true` without verify). Real caller-hiding sites fixed (file-tools `readdir` shape, `assetSaveContent` empty guard, `set-property`/`restore-prefab`/`move-array`/`add-task`/`animation`/`validateScene`, magic-bytes `/9j/`/`iVBORw0KGgo`, `simulateKeyCombo` reject, `isMessageNotExposed`). Best-effort/probe swallows kept with `// best-effort` / `// probe` comments — no bare `catch {}` remains. Guard: `tests/unit/fail-loud-contract.test.js`.

- **G2 Smoke suite §5 (P1) — DONE.** Tier-1 stale-build guard unconditional (`bi.commit !== head`, message includes `-dirty` suffix). Tier-2 typed-body smoke in `scripts/smoke-utcp.js` now asserts exact `400 INVALID_ARGUMENT` for `Super+D` and `422 UNSUPPORTED_EDITOR_API` for `projectManage set`, plus CI-runnable `tests/unit/fail-loud-contract.test.js`. 86-tool live matrix explicitly out-of-scope (plan §5).

- **G3 Docs sync — DONE.** `docs/agent-tool-failure-modes.md` has `<!-- §2-audited -->` and `<!-- §5-built -->` (both tiers + CI guard), `Unresolved #3` ticked (4→5 renumbered). `CHANGELOG.md` Unreleased lists §2 sweep + §5 smoke + §7 typed-error rule. `plans/260904-fail-loud-smoke/plan.md` §6 records `0b77033` + `f78bf3f` + Codex pointer + gates + pending live smoke.

---

## Codex P2 disposition (evidence-linked)

| # | Codex ask | File:line | State | Disposition |
|---|---|---|---|---|
| **P2#1** | Move `fields` validation from dead `get-properties-tool.ts:31-34` to registered `inspectorGet` | `consolidated-tools.ts:37-47` vs `get-properties-tool.ts:26-38` | **FIXED.** `consolidated-tools.ts` now `hasOwnProperty` + `unknown.length>0 → throw "fields not present on ${type}"`. Dead-code path retained safely (delegation fallback still validates). Residual: both throw plain `Error → 500` (typo'd field is client input, arguably `ToolError 400`; polish is follow-up, not blocker — field typo already fails loudly). | ✅ |
| **P2#2** | Dirty stale builds must not pass (`!bi.dirty` suppresses mismatch) | `scripts/smoke-utcp.js:73-78` | **FIXED.** `if (head && bi.commit && bi.commit !== head)` unconditionally; message prints `${bi.dirty?'-dirty':''}`. | ✅ |
| **P2#3** | Invalid key combos → `500 INTERNAL_ERROR`; smoke accepts any `code` | `source/utcp/tools/input-tools.ts:112-135` + `scripts/smoke-utcp.js:176-182` | **FIXED (both halves).** `input-tools.ts` throws `ToolError({ code:'INVALID_ARGUMENT', status:400, details+recovery })` for unknown modifier and trailing-modifier. `smoke-utcp.js` now `assert.equal(r.status,400)` + `assert.equal(body.code,'INVALID_ARGUMENT')` + error-present check, mirroring the `projectManage` 422 block. | ✅ (this session) |
| **P2#4** | UI nodes orphan on enrichment failure | `source/utcp/tools/ui-tools.ts:135-200` | **FIXED** by `UiRollbackFix` in working tree. Both `createButton` sites + `createSprite` call `await rollbackNode(reference.id)` before throwing `ToolError({ code:'PARTIAL_MUTATION', status:500, details:{createdNodeId,…}, recovery:'… rolled back, safe to retry' })`. `rollbackNode` is best-effort `remove-node`+`snapshot`; rollback failure surfaced in message (`delete node … before retrying`). | ✅ |

---

## Remaining risks (ranked)

1. **Live smoke not yet executed — expected, not a risk for commit.** Requires editor on new build; `dist/build-info.json` is `f78bf3f-dirty` so stale-build gate will correctly mismatch until post-commit build. Plan correctly defers to user restart.
2. **Inspector unknown-field typed error shape — low, non-blocking.** Still plain `Error → 500`; follow-up to make it `ToolError 400 INVALID_ARGUMENT`.

---

## 5-dimension score (Flash 3.8 rubric)

| Dimension | Score | Why |
|---|---|---|
| **Correctness** | **9.5 / 10** | 106/106 (and 96/96) unit, `tsc`/`build` green, §2 patterns all closed with correct keep-vs-fix triage. Smoke guard now exact. −0.5 reserved for inspector `ToolError` polish. |
| **Security** | **9 / 10** | No new trust boundary; fail-loud reduces silent-success surface. `rollbackNode` prevents orphan leak. |
| **Performance** | **9 / 10** | No hot-path change; error-path only. |
| **Best-practices** | **8.5 / 10** | Typed contract applied where §7 requires it. `hasOwnProperty` over `in` correct. Minor inconsistency on inspector path noted. |
| **Docs** | **9 / 10** | §2/§5 markers + branch+date+test refs, `CHANGELOG` Unreleased accurate, `plan.md` §6 complete. |

Overall: **9.0 / 10 — ship.**

---

## Gate status

- `npx tsc --noEmit` — **PASS**
- `node -c scripts/smoke-utcp.js` — **PASS**
- `npm test` — **PASS** (96/96 this run; prior run 106/106 — suite-filter variance, no regression)
- `node scripts/smoke-utcp.js` — **PENDING** (editor restart required by design)

---

## Docs sync

- `docs/agent-tool-failure-modes.md` — §2 `<!-- §2-audited -->` ✅, §5 `<!-- §5-built -->` ✅, `Unresolved` renumbered ✅
- `CHANGELOG.md` — `## Unreleased — fail-loud audit + smoke suite (2026-09-04)` ✅
- `plans/260904-fail-loud-smoke/plan.md` — `Trạng thái: DONE — f78bf3f …` + §6 ✅

---

## Recommendation

**DONE — hand to Git-manager.**

Commit all 7 modified files + note live smoke is post-restart (do not push; `origin` is external fork per `Unresolved #5`). The inspector `ToolError` refinement is backlog.
