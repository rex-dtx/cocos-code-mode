## 1. Freeze and evidence

- [ ] Ghi snapshot `docs/tool-portfolio-candidates.json` (80+22=102, qualified 68) + `reports/api-capability-probe-20260920.json` + `reports/api-capability-preview-disabled-reconciliation-20260920.json` vào change này (verify: 3 file hash khớp HEAD bacd213).
- [ ] Đóng `api-capability-resume` ở `status: pending` — không chạy `audit-tool-portfolio` fail, không tính vào publish gate (verify: `node scripts/audit-tool-portfolio.js` vẫn `potentiallyQualifiable 73` trên lane publish, change này không đụng threshold).
- [ ] Tag `bacd213` đã smoke `10/10 pass` ngày 2026-09-21 (build-info bacd213, scene open, handshake responsive) — attach evidence vào `reports/expansion-qualification-20260910.json` преемник.

## 2. Resume lanes (mở khi a quay lại — mỗi lane là một spec riêng)

- [ ] **Lane R1 — Runtime preview re-enable** (candidate 2 + rejected 10): yêu cầu owner bật lại `GAME_VIEW_PREVIEW_DISABLED`, live probe `preview-lifecycle + runtime-transport` trên fixture game-view không flaky. Rows: `previewSessionStart/Stop` (candidate), `runtimeSessionLifecycle/StateObserve/ScenarioRun/Assert`, `previewSessionInspect`, `runtimeWaitForState`, `animationGraphPreview`, `skeletalAnimationPlay/Events`, `audioPlaybackControl/Observe`, `particlePlayback`, `renderDiagnosticsCollect`, `localizationPreview`.
- [ ] **Lane R2 — Project/Scene globals** (candidate 1 + rejected 4): yêu cầu Creator 3.8 `project/set-config` + kênh read-back `_globals`. Rows: `renderConfigurationApply` (candidate, _globals read-back hiện `unsupported-read-back`), `physics2dConfigure/3dConfigure` (project/set-config), `bitmapFontImportSettingsConfigure` (derived fnt, cần 3.8 writer).
- [ ] **Lane R3 — Verification bundles** (implemented-unverified 2): chỉ cần live witness `positive/negative` trên fixture hiện có. Rows: `assetBundleValidate` (runtime-session), `localizationValidate` (resource-contract). Không cần 3.8.
- [ ] **Lane R4 — Replace redesign** (replace 6): yêu cầu thiết kế mới trước khi code. Rows: `prefabVariantCreate` (không có native variant), `tilemapCreate` (TMX import-only), `tweenSequenceCreate/Inspect/Control/Validate` (không có native tween asset — cân nhắc code-gen TypeScript hay runtime adapter).
- [ ] **Lane R5 — Engine features 3.8** (rejected 4): yêu cầu API mới. Rows: `lightBakeManage` (no bake message), `terrainEdit` (no cc.Terrain), `particleConfigure` (no surviving write), `physics topology` đã qualified nên chỉ còn configure.

## 3. Re-entry checklist (khi a bảo "back lại")

- [ ] Chọn lane, tạo proposal riêng từ change này, bump `requiredApprovalCount` nếu potřeba qua decision ghi file, không hạ lén.
- [ ] Chạy `reports/api-capability-probe-20260920.json` pattern probe mới trên artifact không dirty, ghi commit `builtAt` vào evidence.
- [ ] Mỗi row promote phải có `reports/evidence/candidates/<name>/<creator>-<sha>.json` + `positiveTestID/negativeTestID` pass, rồi mới đổi `candidate → qualified` trong `docs/tool-portfolio-candidates.json`.
