# Code Mode 2.x — Tài liệu port

Port `cocos-code-mode` (Creator 3.8.x) sang **Creator 2.4.15**. Branch `cc-2x`.

Docs 3.x gốc: `G:\_ws\_helpers\docs\` (5 lane). Docs ở đây **chỉ** cover phần khác 2.x.

## Đọc gì

| File | Nội dung | Khi nào đọc |
|---|---|---|
| `cocos-2x-port-architecture.md` | Delta 2.x vs 3.x: manifest, entry point, IPC, scene access, Profile | Trước khi sửa bất kỳ code editor-facing |
| `cocos-2x-api-notes.md` | **API verified runtime** — probe thật, không suy đoán. **6 bẫy docs-sai-runtime** + tool surface FINAL + **nguồn thứ 3 (engine source)** + vòng 1.1 (token guard) | Trước khi viết tool mới. Bắt buộc |
| `../README.md` | Tool surface + payload limit + 2 bẫy cho người viết tool mới (bản 2.x, không phải 3.x) | Khi cần overview nhanh |
| `../code-mode-references-2x.d.ts` | Tool surface agent-facing (10 tool / 27 op) | Khi thêm/sửa tool — update tay, không generated |

## Trạng thái port

Plan: `plans/260805-1756-cc-2x-read-only/plan.md` · Vault: `notes/plans/cc-code-mode-cst/1-wip-260805-cc-2x-port/`

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 1 | `@types/editor-2x` + tsconfig + bỏ `@cocos/creator-types` | ✅ build exit 0 |
| 2 | Manifest 2.x + `main.ts` messages shim + Profile 2.x | ✅ plugin load, `/utcp` trả manual |
| 3 | `scene-script.ts` probe — dump engine API thật | ✅ `errors: []` 2 lượt |
| 4 | `assetQuery` + `assetResolve` + `assetReadContent` | ✅ 19/19 curl pass |
| 5 | `nodeQuery` (5 op: tree/dump/info/functions/by_component) | ✅ 8/8 curl pass |
| 6 | `sceneSnapshot` + `componentQuery` + `nodeQuery.at_path` | ✅ 14/14 curl pass |
| 7 | `editorEnvInfo` + `editorSelect` + `projectGetConfig` + d.ts | ✅ 34/34 smoke test |
| 1.1 | Token guard (`maxNodes`/`maxResults`), dump bỏ `types`, not-found → throw, README 2.x, self-check | ✅ 12/12 check, build + package exit 0 |

**Vòng 1 xong: 9 tool, 26 op.** `editorGetLogs` bỏ — 2.4.15 không có API đọc console (verified).

**Vòng 1.2 (đang làm): 27 op** — thêm `assetQuery used_by` (chiều ngược asset → node). Phase A ✅ code + 17 self-check, **chưa smoke** · phase B ✅ tách "nợ thật" vs "không port được" trong `cocos-2x-api-notes.md` · phase C (probe3, cổng vòng 2) ⛔ chờ mở được 2.4.15.

**Tool thứ 10:** `listComponentMethods` — port từ v3 commit `9fc494b`, discovery cho callComponentMethod vòng 2. Output group theo component NAME (không có uuid). Self-check: 22 check.

**Vòng 1 = read-only.** Mutation duy nhất cho phép: `Editor.Selection.*`. Write train vòng 2.

**Vòng 2 (write) CHƯA MỞ — bị chặn cứng.** Cả 3 câu hỏi chặn (`cc.engine.getInstanceById` nhận uuid gì · `Editor.require('scene://utils/node')` export gì · `set-property-by-path` nhận path dạng nào) đều cần probe runtime, mà 2.4.15 phải đang chạy. Không mở được Creator = không làm được vòng 2, không có đường vòng.

## Test tự động

```
npm run check     # build + scripts/check-node-budget.js (22 check)
npm run package   # check + zip — không đóng gói được bản đỏ
```

`check-node-budget.js` verify logic cắt cây của **2 walker độc lập** — `nodeBrief` (scene-script, node `cc.*`) và `truncateHierarchy` (scene-read-tools, JSON từ IPC) — cộng **`find-by-asset`** (match uuid + 2 guard `maxResults`, vòng 1.2) và **`normalizeComponentFunctions`** (defensive parse cho `listComponentMethods`). Chạy được **không cần Creator**: đều là hàm thuần, test dựng `cc` giả + `require` file đã build.

Đây là phần logic scene-script duy nhất verify được offline. Mọi thứ khác vẫn phải smoke test tay trong editor.

⚠️ Sửa 2 walker đó thì **chạy `npm run check`**, đừng chỉ `npm run build` — build xanh không nói gì về logic budget.

## Testbed

```
Editor:   C:\ProgramData\cocos\editors\Creator\2.4.15
Project:  G:\_ws\_helpers\cc-2x-testbed          (template hello-world)
Install:  <project>\packages\cocos-code-mode  → junction tới worktree
Scene:    assets/Scene/helloworld.fire
```

Sau mỗi lần `npm run build` **phải restart editor** — junction chặn file-watcher nên plugin không auto-reload:

```powershell
$p = Get-CimInstance Win32_Process -Filter "Name='CocosCreator.exe'" |
     Where-Object { $_.CommandLine -like '*cc-2x-testbed*' -and $_.CommandLine -notlike '*--type=*' }
Stop-Process -Id $p.ProcessId -Force; Start-Sleep 3
Start-Process "C:\ProgramData\cocos\editors\Creator\2.4.15\CocosCreator.exe" -ArgumentList '--path','G:\_ws\_helpers\cc-2x-testbed'
```

Lọc `--type=` để không giết nhầm child process, lọc `cc-2x-testbed` để không đụng editor khác đang mở.

Probe engine API: handler `probe`/`probe2`/`echo-args` vẫn còn trong `scene-script.ts` (trigger tự động đã gỡ ở phase 6). Gọi tay qua `Editor.Scene.callSceneScript('cocos-code-mode-2x', 'probe2', cb)`.

## Rule bắt buộc khi làm tiếp

1. **Không đoán API.** Mọi `Editor.*` / `cc.*` phải có nguồn — 3 nguồn hợp lệ:
   - corpus `cc_docs` prefix `v2.4/extension/` (editor extension API)
   - **engine source** `C:\ProgramData\cocos\editors\Creator\2.4.15\resources\engine\` — 982 file `.js` plain, đọc thẳng. Đây là nguồn cho `cc.*` internals mà corpus KHÔNG cover
   - kết quả probe runtime

   Không nguồn → ghi Unresolved, không code.
2. **`search_exact` 0 hit ≠ không tồn tại.** Chỉ nghĩa là *docs không nhắc*. Corpus cover editor extension API, KHÔNG cover engine internals — chỗ đó tra engine source. `cc.engine` là ví dụ: corpus 0 hit, engine source có 3 call site thật.
3. **Code editor (`app.asar`) KHÔNG đọc được.** 893 `.ccc` = V8 bytecode mã hoá qua native binding `electron_common_compile`, offline vô hiệu. Chỉ tên file/thư mục đọc được → dùng làm bản đồ probe, không phải API đã xác nhận. Chi tiết: `cocos-2x-api-notes.md` §"Nguồn thứ 3".
4. **Token guard mọi tool trả cây/list.** Hai chiều, không chỉ một:
   - `maxDepth` chặn cây **sâu**
   - `maxNodes` / `maxResults` chặn cây **rộng** — scene slot hay là 1 root + hàng nghìn con cùng cấp, depth không chặn được
   - Node bị cắt báo `truncated` = **lý do** (`'maxDepth'` | `'nodeLimit'`) + `childrenOmitted`; response báo `nodesVisited`/`budgetExhausted`. Cắt im lặng = agent tưởng đã thấy hết.
   - Budget chia **chung** cho mọi root, không reset mỗi root.
5. **`npm run check` exit 0 sau mỗi phase** (build + 22 self-check). Đỏ thì không sang phase sau.
6. **Style hiện tại:** 4-space indent, `async method(args: {...}): Promise<{...}>`, throw `Error` cho invalid input (transport tự bắt → HTTP 500 + `{error}`).
7. **Không-tìm-thấy phải throw**, đừng trả sentinel. 2.4 IPC trả `value: null` / `missed: true` / `null` với HTTP 200 — nghĩa là `try/catch` của agent trượt hết. Tool phải dịch sang `Error`.
8. **Thêm nhánh vào walker → thêm check** vào `scripts/check-node-budget.js`, rồi **mutation-test**: sửa điều kiện thành `if (false)` trong `dist/`, xác nhận test đỏ. Test không đỏ khi phá logic là test vô dụng.
