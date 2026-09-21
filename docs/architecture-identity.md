# Architecture Identity — Cocos Pilot 3x

> Source of truth cho danh pháp kiến trúc. Mọi plan/spec/skill/doc mới phải dùng đúng ID trong bảng này. Cấm dùng `ccb` trần.

## 1) Hệ ID (12 thực thể)

| # | ID | Tên đầy đủ | Thực thể code / runtime | Định danh ví dụ | Ghi chú |
|---|----|------------|--------------------------|-----------------|---------|
| 1 | `cce` | Cocos Creator Editor | Host process `Creator.exe` 3.7/3.8 | `cce:3.7.3 pid=4820 project=G:/proj/my-game` | 1 process = 1 project mở |
| 2 | `ccbe` | Cocos Pilot Extension | Artifact `cocos-pilot-3x@2.1.0` = `dist/main.js` + `source/main.ts` + `UtcpServerManager` | `ccbe#bacd213 build:cocos-pilot-3x.d.ts` | Đóng gói qua `npm run package` → `cocos-pilot-3x.zip` |
| 3 | `ccbi` | Cocos Pilot Instance / Endpoint | 1 `cce` + 1 `ccbe` đang chạy = `http://localhost:<port>/utcp` + `instanceId` | `ccbi:ccp3x_49650 iid=abc123 url=http://localhost:49650/utcp` | Thay `iid` mỗi `startPublishedServer()`; `port` có thể reuse |
| 4 | `ccbr` | Cocos Pilot Registry | `~/.utcp_config.json` + lock `<config>.ccp-lock` + `CCP3X_OWNER_<port>` | `ccbr entry ccp3x_49650 owner=abc123` | Atomic read-modify-write + fsync + rename |
| 5 | `ccbt` | Cocos Pilot Toolset | 321 tools trong `cocos-pilot-3x.d.ts` + `docs/tool-catalog.md` | `ccbt:321 (273 stable / 2 exp / 3 pending / 23 disabled)` | Theo `docs/tool-catalog.md` header |
| 6 | `cm` | Code Mode | Paradigm — gọi tool bằng TS trong `call_tool_chain`, không phải MCP tool rời | `cm:js sandbox call_tool_chain` | Khái niệm, không phải process |
| 7 | `cmm` | Code Mode MCP | Adapter generic `@utcp/code-mode-mcp` chạy như MCP server | `cmm key=cocos-pilot pkg=@utcp/code-mode-mcp` | `mcpServers.cocos-pilot.args = ["@utcp/code-mode-mcp"]` |
| 8 | `utcp` | UTCP | Protocol HTTP `GET/POST /utcp` + `@utcpTool` schema | `utcp manual http://localhost:49650/utcp` | Khai báo bằng `@utcpTool` trong `source/utcp/tools/*` |
| 9 | `mcp` | MCP | Protocol stdio giữa Agent ↔ `cmm` | `mcpServers.cocos-pilot` (key do client đặt) | Không phải product, là transport |
| 10 | `exs` | Express Server | `express@4.21.2` bên trong `ccbe` | `exs:49650` | Chi tiết nội bộ của `ccbe`, chỉ dùng trong log |
| 11 | `bd` | Binding | Tuple `ccbi + projectPath + iid` sau `editorHandshake` | `bd:ccp3x_49650#abc123 project=G:/proj/my-game` | `projectMatches:true && probe.status:responsive` mới mutate |
| 12 | `prs` | Presence | `scripts/session-presence/*` + `editorSessionHeartbeat` | `prs:Active 5s session=uuid` | Advisory, không phải lock |

Quy ước:

- `ccp`/`ccb` — `ccb` đã xóa ở 2.1.0, `ccp` là family prefix mới, cấm dùng đứng một mình. Luôn hậu tố: `ccbe` (artifact), `ccbi:ccp3x_<port>` (runtime instance), `ccbt` (toolset), `ccbr` (registry).
- `cce` là Creator Editor — không lẫn `exs` (Express bên trong `ccbe`).
- `cm` = paradigm; `cmm` = process adapter. Không gọi `cmm` là `ccb mcp`.
- Wire format giữ nguyên `ccp3x_<port>` — đọc là `ccbi id`. Bare `ccp3x`/`ccp2x` (latest alias) đã bỏ — xem Contract C1.
- Version khi cần: `ccbt@3.7.3:321`, `ccbe@2.0.0`.

## 2) Quan hệ

```text
[cce] --hosts--> [ccbe] --runs--> [exs:port] --serves utcp--> [ccbi:ccp3x_<port>]
  |                    | publish/remove              |
  +------------------->[ccbr] <---register_manual----[cmm] <--mcp--> [agent]
  |                    | handshake(bd.iid)           | call_tool_chain
  +--- Editor.Message.request <---> [ccbi] ----------+----> [ccbt:321]
  +--- presence bd/prs ----------------------------------> [cmm/heartbeat]
```

Đọc theo chiều gọi:

1. `cce` host `ccbe`; `ccbe` chạy `exs` và serve `utcp` manual.
2. `ccbe` publish `ccbi:ccp3x_<port>` vào `ccbr`.
3. Agent qua `mcp` gọi `cmm.register_manual(ccbi)` → `cmm` expose `ccbi.*` cho `cm` (`call_tool_chain`).
4. `ccbi` thực thi `ccbt` qua `Editor.Message.request`; write đi kèm `snapshot` (undo).
5. `prs` theo dõi `bd` (advisory).

## 3) Contract

### C1 — Registry Publication (`ccbe → ccbr`)

- Mỗi `ccbe` publish 1 entry duy nhất `ccp3x_<actual-port>` với `CCP3X_OWNER_<port>=iid` + `CCP3X_PROJECT_<port>=projectPath`.
- Serialize qua `<ccbr>.ccb-lock` (poll 25ms, fail sau 5s), write temp + fsync + atomic rename.
- Auto mode reuse `lastAutoPort`; occupied → fallback 1 lần sang OS-assigned port, chỉ lưu sau publish thành công. `fixedServerPort` occupied → fail không fallback.
- Probe cleanup chỉ trên `127.0.0.1`/`localhost`; IPv6 invalid và block publish. Chỉ xóa entry definitively refused và `owner` không đổi sau khi writer giữ lock và reread.
- Bare `ccp3x`/`ccp2x` latest alias không tồn tại; legacy entry migrate về `ccp3x_<port>` theo URL, không giữ alias.

Nguồn: `source/main.ts:35-62`, `source/utcp/config-manager.ts`, `docs/cocos-pilot-code-mode-usage.md:13-19`.

### C2 — Registration + Handshake (`cmm → ccbi → bd`)

- Agent phải `register_manual({name:'ccp3x_<port>', url:'http://localhost:<port>/utcp'})` → `list_tools` chứa namespace → `ccbi.editorHandshake({expectedProjectPath, timeoutMs:1000})`.
- Lưu `bd = {namespace, url, projectPath, iid}`. Yêu cầu `projectMatches:true && probe.status:responsive` trước mọi mutation; scene-dependent ops thêm `sceneReady:true`.
- `bd.iid` đổi → vứt mọi `reference {id,type}` cũ dù `port` không đổi. Re-handshake sau mỗi reconnect/restart/`ccbe` reload.
- Project mismatch / ambiguous selection / unreachable `bd.url` → dừng mutation, không fallback sang `ccbi` khác. Mỗi agent bind `bd` riêng, không ảnh hưởng agent khác.

Nguồn: `docs/cocos-pilot-code-mode-usage.md:52-95`.

### C3 — Mutation (`ccbi → cce`)

- Read tools = `GET`, write tools = `POST` + `Editor.Message.request('scene','snapshot')` để có undo.
- `probe.sceneReady:false` vẫn giữ HTTP nhưng cấm scene mutation (scene chưa sẵn sàng, không phải disconnect).
- Batch ưu tiên: `sceneBatchGet`, `assetBatchQuery`, `nodeBatchSet`.

Nguồn: `README.md:Architecture/Tool Execution`, `source/utcp/tools/*`.

### C4 — Presence (`prs`, advisory)

- `editorSessionHeartbeat` mỗi 5s qua `cmm` hoặc `scripts/session-presence/heartbeat.js` / `supervisor.js`.
- Trạng thái: `Active` ≤15s, `Stale` ≤60s, `Expired`; instance-scoped, clear khi `ccbe` restart. Tối đa 100 sessions.
- Là monitor khuyến cáo, không phải lock/mutex. Agent phải dừng write khi `prs` unsafe và re-handshake trước khi tiếp tục.

Nguồn: `docs/cocos-pilot-code-mode-usage.md:99-179`.

## 4) Quy tắc đặt tên trong plan/spec/code

- Trong plan/spec: viết `ccbi:ccp3x_49650.editorHandshake()` không phải `ccb.handshake()`. Viết `cmm.register(ccbi)` không phải `ccb register`.
- Trong config: `mcpServers.cocos-pilot` là **MCP server key** (do client đặt) trỏ tới `cmm` package `@utcp/code-mode-mcp`; `ccbr` path qua `UTCP_CONFIG_FILE`.
- Trong doc/skill: khi nói code artifact dùng `ccbe`; khi nói runtime instance dùng `ccbi:ccp3x_<port>`; khi nói tập tool dùng `ccbt`.
- Không hardcode `port`; lấy từ `ccbr` hoặc panel Status. Không dùng bare `ccp3x`/`ccp2x` để chọn latest.
- Khi log: prefix `cce`/`ccbe`/`ccbi`/`ccbr`/`cmm`/`bd`/`prs` để greppable.

## 5) Ví dụ copy-ready

```typescript
// C2: cmm register ccbi, verify, handshake → bd
await register_manual({
  manual_call_template: {
    name: 'ccp3x_49650', // ccbi id (từ ccbr hoặc Status)
    call_template_type: 'http',
    url: 'http://localhost:49650/utcp', // ccbi.url
    http_method: 'GET',
    content_type: 'application/json',
  },
});
const tools = await list_tools(); // must contain ccp3x_49650
const bd = await ccp3x_49650.editorHandshake({
  expectedProjectPath: 'G:/projects/my-game',
  timeoutMs: 1000,
});
// require bd.projectMatches === true && bd.probe.status === 'responsive'
const tree = await ccp3x_49650.nodeGetTree({ maxDepth: 2, fields: ['name','active'] });
```

```json
// mcp (key) → cmm (adapter) → ccbr (registry)
{
  "mcpServers": {
    "cocos-pilot": {
      "command": "npx",
      "args": ["@utcp/code-mode-mcp"],
      "env": { "UTCP_CONFIG_FILE": "~/.utcp_config.json" }
    }
  }
}
```

## 6) Lịch sử đổi tên

- Trước 2026-09: `ccb`/`ccp3x` dùng cho cả extension + toolset + namespace + MCP key; `ccp3x` bare là latest alias; `code mode mcp` bị gọi là `ccb mcp`.
- Từ doc này: khóa hệ 12 ID trên; `ccb` chỉ còn là family prefix; bare `ccp3x`/`ccp2x` bỏ; `cm`/`cmm` tách paradigm vs adapter; `bd`/`prs` làm rõ binding/presence.

## 7) Tham chiếu

- `docs/cocos-pilot-code-mode-usage.md` — connection model, bootstrap, watchdog, presence.
- `README.md` — architecture, tool catalog, install.
- `cocos-pilot-3x.d.ts` / `docs/tool-catalog.md` — `ccbt` surface.
- `source/main.ts`, `source/utcp/utcp-server.ts`, `source/utcp/config-manager.ts` — `ccbe`/`ccbr` implementation.
- `.claude/skills/cocos-pilot-3x/SKILL.md` — agent bootstrap skill (đã align với hệ này).
