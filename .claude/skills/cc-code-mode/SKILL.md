---
name: cc-code-mode
description: >
  Cache-first Code Mode UX — dung cc-remoter-3x/cc_remoter_3x (manual cc-remoter-3x, short ccr-3x/ccr_3x) nhu tool thuong.
  Bat khi prompt chua "code mode", "cc-remoter-3x", "cc_remoter_3x", "ccr-3x", "ccr_3x", "cc3x7", "cc2x4", "cocos", "set vi tri",
  "node", "scene", "prefab", "inspector" hoac bat ky tac vu nao can
  thao tac Cocos Editor qua UTCP. Khong can register/search lai neu cache hit.
---

# cc-code-mode — DEPRECATED → cc-remoter-3x — Cache Skill

Dung Code Mode nhu tool thuong, khong `register_manual`/`search_tools` lai moi lan.

## Khi nao kich hoat

Auto khi prompt chua mot trong: `code mode`, `cc-remoter-3x`, `cc_remoter_3x`, `ccr-3x`, `ccr_3x`, `cc3x7`, `cc-remoter-2x`, `cc2x4`, `cocos`,
`set vi tri`, `node`, `scene`, `prefab`, `inspector`, `asset`, `component`,
`preview`, `build` — hoac agent dinh goi `call_tool_chain`.

## Cache

- **Nguon:** `~/.utcp_config.json` (extension ghi `cc-remoter-3x`/`ccr-3x` (+ `cc3x7` legacy) / `cc-remoter-2x`/`ccr-2x` → `http://localhost:<port>/utcp` moi lan start).
- **Bootstrap:** `SessionStart` hook chay `scripts/cc-remoter-bootstrap.js` (compat `code-mode-bootstrap.js`) — doc config, fetch `/utcp` lay **full toolDefs** (`name`+`description`+`inputs`/`outputs`/`tags`/`tool_call_template`), ghi `.claude/cc-remoter-cache.json` (compat `cc-code-mode-cache.json`) + inject `CK_CODE_MODE=ready` vao env. **1 fetch = full detail, khong can `tools_info` tung tool.** Fail-open (khong block session neu Cocos chua mo).
- **Persist:** file cache ton tai qua session; hook refresh moi session (port doi tu fix).

### Doc cache

Cache luu `manuals.<name>.toolDefs[]` — full JSON Schema tung tool (de so sanh khi them/sua tool, khong chi ten). `tools[]` la ten rut gon de check nhanh.
`cat .claude/cc-remoter-cache.json | jq '.manuals."cc-remoter-3x".toolDefs[] | .name'` (compat `.claude/cc-code-mode-cache.json`) hoac `echo $CK_CODE_MODE`.

## Quy tac goi tool

1. **Cache hit** (`CK_CODE_MODE=ready` hoac `.claude/cc-code-mode-cache.json` co `tools[]`): goi thang
   `call_tool_chain("cc_remoter_3x.<tool>({ ... })")` (legacy `cc3x7.<tool>` kept compat) — KHONG `register_manual`, KHONG `search_tools`/`list_tools`/`tools_info`.
2. **Cache miss** (file khong co, hoac Cocos chua mo luc SessionStart): lam 1 lan
   `register_manual` tu `~/.utcp_config.json` → `list_tools` 1 lan → tiep tuc nhu (1).
3. **Port doi / extension restart:** hook doc lai `~/.utcp_config.json` moi session — tu fix, khong can lam gi.

## Retry (stale cache)

Neu `call_tool_chain` tra ve `manual not found` / `tool not found`:

1. Re-`register_manual` tu `~/.utcp_config.json` (doc lai file — port co the doi).
2. Refresh cache: fetch `/utcp` lai, ghi `.claude/cc-remoter-cache.json` (compat `cc-code-mode-cache.json`).
3. Retry `call_tool_chain` 1 lan. Van fail → bao loi + goi `editorGetLogs`.

Chi retry 1 lan — tranh loop.

## Scene preview (chup layout scene)

`previewManage` op `scene_preview` chup anh scene hien tai. 2 gotcha tranh loi:

1. `imageSize` phai la **object** `{width,height}` (vd `{width:1280,height:720}`) — number se ep vuong.
2. `cameraPosition`/`targetPosition` dat tai **tam Canvas** (khong phai `(0,0)`). Lay tam:
   `inspectorGet` node `Canvas` → `position`. Design 1280x720 fitHeight → Canvas tai `(640,360)`,
   `orthographicSize` = `designHeight/2` (=360). Design resolution: `projectManage get` → `general.designResolution`.

## Manual names

- `cc-remoter-3x` (JS: `cc_remoter_3x`, short `ccr-3x`->`ccr_3x`, legacy `cc3x7`/`cc37`/`CocosEditor3x7`) — Cocos Creator 3.7 (repo nay)
- `cc-remoter-2x` (JS: `cc_remoter_2x`, short `ccr-2x`->`ccr_2x`, legacy `cc2x4`) — Cocos Creator 2.4 (nhanh `cc-2x`, cung co che)

Tu dong theo `~/.utcp_config.json`; khong hardcode port.

## Khong lam

- Khong tach moi Cocos tool thanh MCP tool rieng — giu JS batch (`call_tool_chain`) vi tiet kiem token.
- Khong sua `source/utcp/*` hay fork `@utcp/code-mode-mcp`.
