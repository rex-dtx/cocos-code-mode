# Code Mode 2.x — Tài liệu port

Port `cocos-code-mode` (Creator 3.8.x) sang **Creator 2.4.15**. Branch `cc-2x`.

Docs 3.x gốc: `G:\_ws\_helpers\docs\` (5 lane). Docs ở đây **chỉ** cover phần khác 2.x.

## Đọc gì

| File | Nội dung | Khi nào đọc |
|---|---|---|
| `cocos-2x-port-architecture.md` | Delta 2.x vs 3.x: manifest, entry point, IPC, scene access, Profile | Trước khi sửa bất kỳ code editor-facing |
| `cocos-2x-api-notes.md` | **API verified runtime** — probe thật, không suy đoán. **6 bẫy docs-sai-runtime** + tool surface FINAL | Trước khi viết tool mới. Bắt buộc |
| `../code-mode-references-2x.d.ts` | Tool surface agent-facing (9 tool) | Khi thêm/sửa tool — update tay, không generated |

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

**Vòng 1 xong: 9 tool, 26 op.** `editorGetLogs` bỏ — 2.4.15 không có API đọc console (verified).

**Vòng 1 = read-only.** Mutation duy nhất cho phép: `Editor.Selection.*`. Write train vòng 2.

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

Probe engine API: handler `probe`/`probe2`/`echo-args` vẫn còn trong `scene-script.ts` (trigger tự động đã gỡ ở phase 6). Gọi tay qua `Editor.Scene.callSceneScript('cocos-code-mode', 'probe2', cb)`.

## Rule bắt buộc khi làm tiếp

1. **Không đoán API.** Mọi `Editor.*` / `cc.*` phải có nguồn: corpus `cc_docs` prefix `v2.4/extension/`, hoặc kết quả probe. Không nguồn → ghi Unresolved, không code.
2. **`search_exact` 0 hit ≠ không tồn tại.** Chỉ nghĩa là *docs không nhắc*. Corpus cover editor extension API, KHÔNG cover engine internals. `cc.engine` là ví dụ: 0 hit nhưng tồn tại thật.
3. **Token guard mọi tool trả cây/dump.** Default `maxDepth`, truncate + báo `childrenCount`/`truncated`.
4. **`npm run build` exit 0 sau mỗi phase.** Đỏ thì không sang phase sau.
5. **Style hiện tại:** 4-space indent, `async method(args: {...}): Promise<{...}>`, throw `Error` cho invalid input (transport tự bắt → HTTP 500 + `{error}`).
