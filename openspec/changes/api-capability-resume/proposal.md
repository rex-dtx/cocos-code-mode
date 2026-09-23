## Why

Creator 3.7.3 đã đạt **321 registered / 154 qualified (86 baseline + 68 portfolio) / 90.28% workflow** — đủ để agent thao tác component/editor "nhanh nhất có thể" (ui-layout, prefab, tilemap, assets/import, animation, skeletal, physics, audio, particles, rendering, terrain, build). Phần còn lại bị chặn bởi **preview-disable owner (GAME_VIEW_PREVIEW_DISABLED, c0459fd)**, **IPC 3.7.3 không tồn tại (project/set-config, _globals read-back, light-bake, Terrain)**, và **thiết kế thay thế (tween sequence, prefabVariant)**. Thay vì giữ worktree mở với gate vỡ `potentiallyQualifiable 73 < required 82`, chuyển_lane sang **build/security → publish** và đóng băng API ở mức "vừa đủ dùng".

Plan này là **tủ pending** cho lần quay lại: gom toàn bộ candidate/rejected/replace chưa xong, giữ nguyên evidence/probe, và ghi rõ điều kiện resume.

## What Changes

- Tạo change mới `api-capability-resume` ở trạng thái **pending** (không implement trong đợt publish). Toàn bộ scope dưới đây là deferred, không tính vào gate hiện tại.
- Ghi nhận 11 hàng **treo trực tiếp** trên `docs/tool-portfolio-candidates.json` (2026-09-21, bacd213):
  - `candidate` (3): `renderConfigurationApply` (rendering-materials, read-back _globals thiếu), `previewSessionStart/Stop` (runtime-qa, preview-lifecycle).
  - `implemented-unverified` (2): `assetBundleValidate` (assets-import, runtime-session), `localizationValidate` (localization, resource-contract).
  - `replace` (6): `prefabVariantCreate`, `tilemapCreate`, `tweenSequenceCreate/Inspect/Control/Validate` (tween domain — không có native asset, cần thiết kế lại).
- Ghi nhận 23 hàng **rejected chờ revisit 3.8+** (23 trong 102, gồm 4 reserve): `animationGraphPreview`, `skeletalAnimationPlay/Events`, `audioPlaybackControl/Observe`, `physics2dConfigure/3dConfigure`, `particleConfigure/Playback`, `renderDiagnosticsCollect`, `lightBakeManage`, `terrainEdit`, `localizationInspect/TableEdit/Preview`, `runtimeSessionLifecycle/StateObserve/ScenarioRun/Assert`, `previewSessionInspect/ResolutionSet`, `runtimeWaitForState`, `bitmapFontImportSettingsConfigure`.
- Ghi nhận backlog `docs/next-update-3x8-capability-backlog.json`: 3 `unsupportedOnCreator373` (projectManage set, physics2d/3dConfigure) + 9 `unverifiedOrFixtureBlocked` cần fixture/transport mới.
- Định nghĩa **điều kiện resume**: Creator 3.8+ IPC (`project/set-config`, `_globals` read-back, preview resolution), fixture game-view không còn owner-disable, và thiết kế mới cho tween/prefabVariant/tilemapCreate.
- Ghi riêng lane **R6 — Creator popup observability** qua tracked plan `notes/plans/cc-code-mode-cst/2-todo-260922__tbd-creator-popup-detection/plan.md`: read-only blocking-dialog detection, không dismissal, không tính vào frozen portfolio denominator cho tới khi có proposal/candidate decision riêng.
- Không đụng tới 68 qualified hiện tại; không hạ gate lén — mọi thay đổi `requiredApprovalCount` phải có decision ghi file.

## Capabilities

### New Capabilities
- `resume-orchestrator`: điều kiện/phase để mở lại từng domain khi 3.8 hoặc fixture sẵn sàng.
- `tween-sequence-design`: thiết kế mới cho tween nếu quyết thay thế code-gen.

### Modified Capabilities
- None trong đợt pending này. Khi resume, các capability dưới sẽ được promote thành spec riêng: `render-configuration`, `preview-session`, `bundle-validation`, `localization-validation`, `tween-sequence`.

## Goal (a's intent, frozen)

> Mở rộng API đến **mức vừa đủ dùng để agent thao tác với các components của editor nhanh nhất có thể**, rồi **ngưng** để làm **build/security → publish/release**, sau đó **mở lại API** theo plan pending này. "Vừa đủ" = 154 qualified hiện tại đã cover thao tác component cơ bản; phần pending là mở rộng sâu (preview runtime, project settings, bake, terrain, tween code-gen) không chặn publish.

## Non-Goals (trong pending)

- Không implement bất kỳ tool mới nào trong change này.
- Không đổi `scripts/audit-tool-portfolio.js` gate hay `docs/tool-portfolio-candidates.json` state — mọi promote phải qua live probe mới trên artifact không dirty và commit mới.
