---
name: cc-bridge-2x
description: >
  Use when a task mentions Code Mode, ccb2x, Cocos, scene, prefab, inspector,
  assets, components, preview, or build and needs Cocos Creator 2.4 control through UTCP.
---

# CC Bridge 2x

Use CC Bridge through Code Mode MCP. The cache holds discovery metadata only; it never proves the current MCP process registered a manual.

## Khi nào kích hoạt

Khi prompt chứa `code mode`, `ccb2x`, `cc-bridge-2x`, `cocos`, `node`, `scene`,
`prefab`, `inspector`, `asset`, `component`, `preview`, `build` — hoặc cần gọi
`call_tool_chain`.

## Bootstrap bắt buộc mỗi session

1. Đọc template hiện tại trong `~/.utcp_config.json`; dùng `ccb2x` (short alias) hoặc `cc-bridge-2x` (canonical).
2. Gọi `register_manual` với **toàn bộ template** đó.
3. Gọi `list_tools`; xác nhận có ít nhất một tool thuộc namespace đã chọn.
4. Chỉ sau đó gọi `call_tool_chain` với `<manual>.<tool>(args)`.

Không suy ra manual đã registered từ `CK_CODE_MODE`, `.claude/cc-bridge-cache.json`, hay tool list của MCP session trước. Cache chỉ tránh phải đọc từng schema từ manual; live manual mới là source of truth.

## Retry

Khi `call_tool_chain` trả `manual not found` hoặc `tool not found`:

1. Đọc lại `~/.utcp_config.json`; Cocos có thể vừa restart và đổi port.
2. Re-register template hiện tại, rồi xác nhận bằng `list_tools`.
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

- `ccb2x` — short alias khuyến nghị.
- `cc-bridge-2x` — canonical template.

Extension tự cập nhật URL hiện tại trong `~/.utcp_config.json`; không hard-code port. Alias legacy `ccb-2x`/`ccb_2x` được migrate sang `ccb2x`, không dùng cho registration mới.

## Không làm

- Không tách mỗi Cocos tool thành MCP tool riêng; giữ JS batch trong `call_tool_chain`.
- Không sửa `source/utcp/*` hoặc fork `@utcp/code-mode-mcp` chỉ để đổi workflow agent.
