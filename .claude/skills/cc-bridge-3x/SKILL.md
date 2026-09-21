---
name: cc-bridge-3x
description: >
  Use when a task mentions Code Mode, ccb3x, ccb2x, Cocos, scene, prefab,
  inspector, assets, components, preview, or build and needs Cocos Editor
  control through UTCP.
---

# cc-bridge-3x

Use CC Bridge through Code Mode MCP. Cache is tool metadata only; it never proves that the current MCP process registered a manual.

## Khi nao kich hoat

Auto khi prompt chua mot trong: `code mode`, `ccb3x`/`ccb3x_<port>`, `ccb2x`/`ccb2x_<port>`, `cocos`,
`set vi tri`, `node`, `scene`, `prefab`, `inspector`, `asset`, `component`,
`preview`, `build` — hoac agent dinh goi `call_tool_chain`.

## Bootstrap and cache

- **Source:** `~/.utcp_config.json`. Each running Cocos Editor writes `ccb3x_<port>`; bare `ccb3x` targets the latest editor. Creator 2.4 uses the parallel `ccb2x` names.
- **Cache:** `scripts/cc-bridge-bootstrap.js` fetches each live `/utcp` manual into `.claude/cc-bridge-cache.json`. It is schema/discovery metadata; it does not register manuals in the Code Mode MCP process.

### Required session bootstrap

1. Read the current template from `~/.utcp_config.json`; choose `ccb3x` or `ccb2x` unless a specific `ccb3x_<port>` or `ccb2x_<port>` editor is required.
2. Call `register_manual` with that complete template.
3. Call `list_tools`; confirm it contains at least one tool under the selected manual's namespace.
4. Only then call `call_tool_chain` with `<selected-manual>.<tool>(args)`.

Never infer registration from `CK_CODE_MODE`, `.claude/cc-bridge-cache.json`, or a tool list from an earlier MCP session.

### Retry

On `manual not found` or `tool not found`:

1. Re-read `~/.utcp_config.json`, because the editor may have restarted on a different port.
2. Re-register the selected current template and confirm it with `list_tools`.
3. Retry the original `call_tool_chain` once.

If it still fails, report the error and call `editorGetLogs`; do not retry in a loop.

## Scene preview (chup layout scene)

`previewManage` op `scene_preview` chup anh scene hien tai. 2 gotcha tranh loi:

1. `imageSize` phai la **object** `{width,height}` (vd `{width:1280,height:720}`) — number se ep vuong.
2. `cameraPosition`/`targetPosition` dat tai **tam Canvas** (khong phai `(0,0)`). Lay tam:
   `inspectorGet` node `Canvas` → `position`. Design 1280x720 fitHeight → Canvas tai `(640,360)`,
   `orthographicSize` = `designHeight/2` (=360). Design resolution: `projectManage get` → `general.designResolution`.

## Tool catalog (bacd213, 321 tools) — status per tool

Live catalog: `docs/tool-catalog.md` (generated 2026-09-21, bacd213). Summary:

- **stable 273** — baseline/expansion (219) + portfolio qualified (54 live; +1 `bitmapFontImportSettingsAudit` gộp vào `assetImporterAudit`): dùng trực tiếp, smoke 10/10 pass. Groups: animation/asset/audio/build/editor/image/material/model/node/particle/physics2d/physics3d/prefab/runtime/scene/script/spine/sprite/terrain/tilemap/ui. Batch ưu tiên: `sceneBatchGet`, `assetBatchQuery`, `nodeBatchSet`.
- **experimental 2** — `assetBundleValidate`, `localizationValidate` (implemented-unverified) — code có, thiếu live witness, pending verify.
- **pending 3** — `renderConfigurationApply` (_globals read-back thiếu trên 3.7.3, chờ 3.8), `previewSessionStart`/`Stop` (preview-lifecycle disabled). Gọi vẫn 422 cho tới khi 3.8/fixture.
- **disabled 23** — `audioPlaybackControl/Observe`, `particleConfigure/Playback`, `physics2d/3dConfigure`, `previewResolutionSet/SessionInspect`, `animationGraphPreview`, `skeletalAnimationPlay/Events`, `lightBakeManage`, `terrainEdit`, `localizationInspect/TableEdit/Preview`, `runtimeSessionLifecycle/StateObserve/ScenarioRun/Assert/WaitForState`, `renderDiagnosticsCollect`, `bitmapFontImportSettingsConfigure`. Probe đã chứng minh unsupported / owner-disable (`reports/api-capability-probe-20260920.json`, `api-capability-preview-disabled-reconciliation-20260920.json`) — typed 422, không retry loop.
- **deprecated 6** — `prefabVariantCreate`, `tilemapCreate`, `tweenSequenceCreate/Inspect/Control/Validate` — không register live, cần redesign (lane R4 trong HOLD `openspec/changes/api-capability-resume` + `plans/3-hold-260921__tbd-api-capability-resume`).

Khi tool trả 422 `UNSUPPORTED_EDITOR_API` / `PREVIEW_FEATURE_DISABLED`, không gọi lại — đọc `editorGetLogs` và chờ 3.8/fixture như HOLD plan.

## Manual names

- `ccb3x` (+ `ccb3x_<port>` khi mo nhieu Editor Cocos 3.7 cung luc; `ccb3x` la latest, per-port cho target cu the). `ccb2x`/`ccb2x_<port>` — Creator 2.4 (nhanh `cc-2x`). Goi `ccb3x.nodeGetTree(...)` (latest) hoac `ccb3x_49650.nodeGetTree(...)` (per-editor). Cong hien thoi: manual ten truc tiep `ccb3x`/`ccb2x`, khong con hyphen/underscore alias.



Tu dong theo `~/.utcp_config.json`; khong hardcode port.

## Khong lam

- Khong tach moi Cocos tool thanh MCP tool rieng — giu JS batch (`call_tool_chain`) vi tiet kiem token.
- Khong sua `source/utcp/*` hay fork `@utcp/code-mode-mcp`.
