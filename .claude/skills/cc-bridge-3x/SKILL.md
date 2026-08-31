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

## Manual names

- `ccb3x` (+ `ccb3x_<port>` khi mo nhieu Editor Cocos 3.7 cung luc; `ccb3x` la latest, per-port cho target cu the). `ccb2x`/`ccb2x_<port>` — Creator 2.4 (nhanh `cc-2x`). Goi `ccb3x.nodeGetTree(...)` (latest) hoac `ccb3x_49650.nodeGetTree(...)` (per-editor). Cong hien thoi: manual ten truc tiep `ccb3x`/`ccb2x`, khong con hyphen/underscore alias.



Tu dong theo `~/.utcp_config.json`; khong hardcode port.

## Khong lam

- Khong tach moi Cocos tool thanh MCP tool rieng — giu JS batch (`call_tool_chain`) vi tiet kiem token.
- Khong sua `source/utcp/*` hay fork `@utcp/code-mode-mcp`.
