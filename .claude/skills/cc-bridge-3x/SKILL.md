---
name: cc-bridge-3x
description: >
  Cache-first Code Mode UX — dung manual ccb3x (ccb2x cho 2.4) nhu tool thuong.
  Bat khi prompt chua "code mode", "ccb3x", "ccb2x", "cocos", "set vi tri",
  "node", "scene", "prefab", "inspector" hoac bat ky tac vu nao can
  thao tac Cocos Editor qua UTCP. Khong can register/search lai neu cache hit.
---

# cc-bridge-3x — Cache Skill

Dung Code Mode nhu tool thuong, khong `register_manual`/`search_tools` lai moi lan.

## Khi nao kich hoat

Auto khi prompt chua mot trong: `code mode`, `ccb3x`/`ccb3x_<port>`, `ccb2x`/`ccb2x_<port>`, `cocos`,
`set vi tri`, `node`, `scene`, `prefab`, `inspector`, `asset`, `component`,
`preview`, `build` — hoac agent dinh goi `call_tool_chain`.

## Cache

- **Nguon:** `~/.utcp_config.json` — multi-editor rendezvous. Moi Editor dang chay ghi 1 entry `ccb3x_<port>`; bare `ccb3x` la pointer toi Editor **latest** (moi start nhat). Mo 2 project Cocos cung luc → 2 entries port khac nhau, khong dup (invariant: max 1 entry per URL). Editor unload tu GC entry cua no; 2x tuong tu voi `ccb2x`/`ccb2x_<port>`.
- **Bootstrap:** `SessionStart` hook chay `scripts/cc-bridge-bootstrap.js` — doc config, fetch `/utcp` lay **full toolDefs** (`name`+`description`+`inputs`/`outputs`/`tags`/`tool_call_template`), ghi `.claude/cc-bridge-cache.json` + inject `CK_CODE_MODE=ready` vao env. **1 fetch = full detail, khong can `tools_info` tung tool.** Fail-open (khong block session neu Cocos chua mo).
- **Persist:** file cache ton tai qua session; hook refresh moi session (port doi tu fix).

### Doc cache

Cache luu `manuals.<name>.toolDefs[]` — full JSON Schema tung tool (de so sanh khi them/sua tool, khong chi ten). `tools[]` la ten rut gon de check nhanh.
`cat .claude/cc-bridge-cache.json | jq '.manuals."ccb3x".toolDefs[] | .name'` hoac theo port `jq '.manuals."ccb3x_49650".toolDefs'`. Hoac `echo $CK_CODE_MODE`.

## Quy tac goi tool

1. **Cache hit** (`CK_CODE_MODE=ready` hoac `.claude/cc-bridge-cache.json` co `tools[]`): goi thang
   `call_tool_chain("ccb3x.<tool>({ ... })")` hoac `ccb3x_<port>.*` cho target cu the — KHONG `register_manual`, KHONG `search_tools`/`list_tools`/`tools_info`.
2. **Cache miss** (file khong co, hoac Cocos chua mo luc SessionStart): lam 1 lan
   `register_manual` tu `~/.utcp_config.json` → `list_tools` 1 lan → tiep tuc nhu (1).
3. **Port doi / extension restart:** hook doc lai `~/.utcp_config.json` moi session — tu fix, khong can lam gi.

## Retry (stale cache)

Neu `call_tool_chain` tra ve `manual not found` / `tool not found`:

1. Re-`register_manual` tu `~/.utcp_config.json` (doc lai file — port co the doi).
2. Refresh cache: fetch `/utcp` lai, ghi `.claude/cc-bridge-cache.json`.
3. Retry `call_tool_chain` 1 lan. Van fail → bao loi + goi `editorGetLogs`.

Chi retry 1 lan — tranh loop.

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
