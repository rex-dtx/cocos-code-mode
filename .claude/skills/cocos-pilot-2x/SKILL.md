---
name: cocos-pilot-2x
description: >
  Use when a task mentions Code Mode, ccp2x, Cocos, scene, prefab, inspector,
  assets, components, preview, or build and needs Cocos Creator 2.4 control through UTCP.
---

# Cocos Pilot 2x

Use Cocos Pilot through Code Mode MCP. The cache holds discovery metadata only; it never proves the current MCP process registered a manual.

## Khi nào kích hoạt

Khi prompt chứa `code mode`, `ccp2x`, `cocos-pilot-2x`, `cocos`, `node`, `scene`,
`prefab`, `inspector`, `asset`, `component`, `preview`, `build` — hoặc cần gọi
`call_tool_chain`.

## Bootstrap bắt buộc mỗi session

1. Đọc `~/.utcp_config.json` hoặc Configuration/Status và chọn template `ccp2x_<port>` khớp Creator/project cần thao tác. Xác nhận `CCP2X_OWNER_<port>` và `CCP2X_PROJECT_<port>` khớp project dự định. Bare hoặc bridge legacy là foreign/unowned; không dùng để chọn editor.
2. Gọi `register_manual` với **toàn bộ template** `ccp2x_<port>` đó.
3. Gọi `list_tools`; xác nhận có `ccp2x_<port>.editorHandshake`.
4. Gọi `ccp2x_<port>.editorHandshake({expectedProjectPath,timeoutMs:1000})` với absolute project path. Chỉ mutate khi `projectMatches:true` và `probe.status:'responsive'`; lưu instanceId rồi re-handshake khi restart/reconnect. `sceneReady` chỉ ràng buộc các thao tác cần scene.
5. Chỉ sau đó gọi `call_tool_chain` với `<manual>.<tool>(args)`.

Không suy ra manual đã registered từ `CK_CODE_MODE`, `.claude/cocos-pilot-2x-cache.json`, hay tool list của MCP session trước. Cache chỉ tránh phải đọc từng schema từ manual; live manual mới là source of truth.

## Retry

Khi `call_tool_chain` trả `manual not found` hoặc `tool not found`:

1. Đọc lại `~/.utcp_config.json`; Creator có thể vừa restart và đổi port/instance.
2. Re-register exact `ccp2x_<port>` template, xác nhận bằng `list_tools`, rồi re-handshake project/instance.
3. Retry đúng một lần.

Vẫn lỗi: báo lỗi và gọi `editorGetLogs`. Không retry loop.

## Discover trước khi mutate

1. `sceneSnapshot` để lấy hierarchy và giữ `uuid` node cần sửa.
2. `componentQuery` hoặc `nodeQuery` để khám phá component/property thực tế.
3. Gọi tool mutation chuyên biệt (`nodeSetProperty`, `nodeComponentManage`, `nodeMove`, …).
4. Re-read field đã đổi khi task cần xác nhận.

Ưu tiên batch tools cho nhiều mutation độc lập. Dùng `sceneScript` chỉ để probe handler đã biết; không đoán message hay property.

## Preview

Creator 2.4 dùng `editorGetScenePreview`; tool trả screenshot hoặc fallback note nếu `scene:capture-screenshot` không tồn tại. Không dùng workflow camera/viewport của 3.x.

## Manual names

- `ccp2x_<port>` — identity per Creator 2.4 instance. Tên template và URL phải cùng port; owner/project marker phải khớp.
- Bare `ccb2x`/`cc-bridge-2x` — historical, foreign/unowned entries may remain; never bind or publish these aliases.

Extension publish URL + owner/project cho per-port template; không hard-code port. Reload/restart đổi instanceId nên bỏ reference cũ và bind lại.

## Không làm

- Không tách mỗi Cocos tool thành MCP tool riêng; giữ JS batch trong `call_tool_chain`.
- Không sửa `source/utcp/*` hoặc fork `@utcp/code-mode-mcp` chỉ để đổi workflow agent.
