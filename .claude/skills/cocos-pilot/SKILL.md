---
name: cocos-pilot-3x
description: >
  Use when a task mentions Code Mode, ccp3x, ccp2x, Cocos, scene, prefab,
  inspector, assets, components, preview, or build and needs Cocos Editor
  control through UTCP.
---

# cocos-pilot-3x

Use Cocos Pilot through Code Mode MCP. Cache is tool metadata only; it never proves that the current MCP process registered a manual. Identity glossary: `docs/architecture-identity.md` (`cce`/`ccbe`/`ccbi`/`ccbr`/`ccbt`/`cm`/`cmm`/`bd`/`prs`). Cấm dùng `ccb` trần — luôn hậu tố.

## Khi nao kich hoat

Auto khi prompt chua mot trong: `code mode`, `ccp3x`/`ccp3x_<port>`, `ccp2x`/`ccp2x_<port>`, `cocos`,
`set vi tri`, `node`, `scene`, `prefab`, `inspector`, `asset`, `component`,
`preview`, `build` — hoac agent dinh goi `call_tool_chain`.

## Bootstrap and cache

- **Source (`ccbr`):** `~/.utcp_config.json`. Mỗi `ccbe` đang chạy publish 1 `ccbi:ccp3x_<port>` (bare `ccp3x`/`ccp2x` latest đã bỏ — mỗi Editor là 1 port riêng). Creator 2.4 dùng song song `ccp2x_<port>`. Chi tiết: `docs/architecture-identity.md` C1.
- **Cache:** `scripts/cocos-pilot-bootstrap.js` fetches mỗi `ccbi` live `/utcp` manual vào `.claude/cocos-pilot-cache.json`. Chỉ là schema/discovery metadata; không thay thế `register_manual` của `cmm` trong MCP process hiện tại.

### Required session bootstrap (`cmm` → `ccbi` → `bd`, C2)

1. Đọc `ccbr` (`~/.utcp_config.json`) hoặc **Cocos Pilot 3x → Status**; chọn đúng `ccbi:ccp3x_<port>` cho `cce` + project cần thao tác. Không dùng bare `ccp3x` latest.
2. `register_manual` với template **per-port** đầy đủ (`name:'ccp3x_<port>'`, `url:'http://localhost:<port>/utcp'`).
3. `list_tools` — confirm chứa namespace `ccp3x_<port>` đã chọn.
4. `ccp3x_<port>.editorHandshake({expectedProjectPath, timeoutMs:1000})` → lưu `bd = {namespace, url, projectPath, iid}`; yêu cầu `projectMatches:true && probe.status:responsive` trước mọi mutation. `iid` đổi → vứt mọi `reference` cũ.
5. Chỉ sau đó mới `call_tool_chain` qua `ccp3x_<port>.<tool>(args)` (`ccbt`).

Never infer registration from `CK_CODE_MODE`, `.claude/cocos-pilot-cache.json`, or a tool list from an earlier MCP session. Sau reconnect/restart/`ccbe` reload phải re-handshake; không fallback sang `ccbi` khác.

### Retry and Creator-visible failures

On `manual not found` or `tool not found`:

1. Re-read `ccbr` (`~/.utcp_config.json`), vì `cce`/`ccbe` có thể restart sang port khác (C1: auto reuse / fallback).
2. Re-register `ccbi:ccp3x_<port>` hiện tại và confirm bằng `list_tools`.
3. Retry `call_tool_chain` 1 lần.

If a `cc-pilot/call_tool_chain` result has `success:true` but its `logs` contain `[ERROR] Code execution failed` (or the chain otherwise fails client-side), treat the command as failed. When the bound `ccbi` is still reachable, make one best-effort follow-up chain that calls `editorNotify({ level:'error', title:'Cocos Pilot command failed', message:<bounded summary>, openPanel:true })`; this writes the Creator log and opens Agent Inbox so the user sees the failure. Do not include secrets, transport URLs, or full raw payloads. If notification fails, report both failures to the user; never retry the original mutation blindly.

For a server/tool error already visible in Creator logs, call `editorGetLogs` for bounded evidence and avoid duplicate notification loops.

## Scene preview (chup layout scene)

`previewManage` op `scene_preview` chup anh scene hien tai. 2 gotcha tranh loi:

1. `imageSize` phai la **object** `{width,height}` (vd `{width:1280,height:720}`) — number se ep vuong.
2. `cameraPosition`/`targetPosition` dat tai **tam Canvas** (khong phai `(0,0)`). Lay tam:
   `inspectorGet` node `Canvas` → `position`. Design 1280x720 fitHeight → Canvas tai `(640,360)`,
   `orthographicSize` = `designHeight/2` (=360). Design resolution: `projectManage get` → `general.designResolution`.

## Manual names

- `ccp3x_<port>` (`ccbi` id) cho Creator 3.x; `ccp2x_<port>` cho Creator 2.4. Gọi `ccp3x_49650.nodeGetTree(...)` (per-`ccbi`), không còn `ccp3x` bare latest. Namespace phải khớp `url` port (C1/C2). Chi tiết: `docs/architecture-identity.md`.

Tu dong theo `ccbr`; khong hardcode port.

## Khong lam

- Khong tach moi `ccbt` tool thanh MCP tool rieng — giu JS batch (`call_tool_chain`, `cm`) vi tiet kiem token.
- Khong sua `source/utcp/*` hay fork `@utcp/code-mode-mcp` (`cmm`).
