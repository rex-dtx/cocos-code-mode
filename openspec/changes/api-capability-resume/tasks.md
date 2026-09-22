## 1. Freeze and evidence

- [x] Ghi snapshot hash-reference trong `freeze-evidence.json`: `docs/tool-portfolio-candidates.json` (80+22=102, qualified 68) + `reports/api-capability-probe-20260920.json` + `reports/api-capability-preview-disabled-reconciliation-20260920.json` + backlog, tất cả bind với commit `bacd213`.
- [x] Giữ `api-capability-resume` ở `status: pending`; `node scripts/audit-tool-portfolio.js` hiện pass với `potentiallyQualifiable 73`, `approvedCount 70`, `requiredApprovalCount 82`, `marginEroded:true`. Change không sửa threshold hay portfolio state; `--require-ready` vẫn phải fail cho publish gate.
- [x] Trace smoke freeze `bacd213` ngày 2026-09-21: commit tồn tại; claim `10/10 pass`, scene open, handshake responsive được giữ trong `proposal.md`, `design.md`, `docs/tool-catalog.md`, và `freeze-evidence.json`. Không có transcript live độc lập để nâng thành witness mới.

## 2. Resume lanes (mở khi a quay lại — mỗi lane là một spec riêng)

- [ ] **Lane R1 — Runtime preview re-enable** — blocked: owner phải bật `GAME_VIEW_PREVIEW_DISABLED`; cần live probe `preview-lifecycle + runtime-transport` trên fixture game-view không flaky. Rows: `previewSessionStart/Stop`, `runtimeSessionLifecycle/StateObserve/ScenarioRun/Assert`, `previewSessionInspect`, `runtimeWaitForState`, `animationGraphPreview`, `skeletalAnimationPlay/Events`, `audioPlaybackControl/Observe`, `particlePlayback`, `renderDiagnosticsCollect`, `localizationPreview`.
- [ ] **Lane R2 — Project/Scene globals** — blocked: Creator ≥3.8 với `project/set-config` và `_globals` read-back. Rows: `renderConfigurationApply`, `physics2dConfigure/3dConfigure`, `bitmapFontImportSettingsConfigure`.
- [ ] **Lane R3 — Verification bundles** — blocked: fresh positive/negative live witnesses on fixtures. Rows: `assetBundleValidate`, `localizationValidate`; không cần 3.8.
- [ ] **Lane R4 — Replace redesign** — blocked: design proposal trước code. Rows: `prefabVariantCreate`, `tilemapCreate`, `tweenSequenceCreate/Inspect/Control/Validate`.
- [ ] **Lane R5 — Engine features 3.8** — blocked: Creator ≥3.8 API witness. Rows: `lightBakeManage`, `terrainEdit`, `particleConfigure`; physics topology đã qualified nên chỉ còn configure.

## 3. Re-entry checklist (khi a bảo "back lại")

- [ ] Chọn lane, tạo proposal riêng từ change này, bump `requiredApprovalCount` nếu potřeba qua decision ghi file, không hạ lén.
- [ ] Chạy `reports/api-capability-probe-20260920.json` pattern probe mới trên artifact không dirty, ghi commit `builtAt` vào evidence.
- [ ] Mỗi row promote phải có `reports/evidence/candidates/<name>/<creator>-<sha>.json` + `positiveTestID/negativeTestID` pass, rồi mới đổi `candidate → qualified` trong `docs/tool-portfolio-candidates.json`.
