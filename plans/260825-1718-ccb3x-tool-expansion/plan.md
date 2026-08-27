# ccb3x Tool Expansion — Roadmap mượn điểm mạnh funplay/cocos-mcp/DaxianLee

> **Ngày:** 2026-08-25 → 2026-08-27 · **Branch:** `cc-3x7` · **Type:** roadmap / T1 khi implement
> **Nguồn:** funplay-cocos-mcp (105 full / 39 core, MIT, 3.8+), RomaRogov/cocos-mcp (16), DaxianLee/cocos-mcp-server (50), `docs/parity-v2-v3.md`

## 0. Status

| Hạng mục | Status |
|---|---|
| Safety layer (`javascript-safety.ts` + `path-safety.ts`) | ✅ **XONG** |
| Guard registry + pipeline (`execute/` infra) | ✅ **XONG** |
| `executeJavascript` (scene+editor, safety-guarded) | ✅ **XONG** — tool 47th |
| Result envelope + auto-refs | ✅ **XONG** — server-level, opt-in |
| Tool profiles (core/full) + annotations | ✅ **XONG** — server-level filter |
| Đợt 1: diagnostics + files + UI + runtime | ✅ **XONG** — 47→63 |
| Đợt 2: batch + validation + screenshot | ✅ **XONG** — 63→69 |
| Đợt 3: events + sceneSnapshot + meta | ✅ **XONG** — 69→83 |
| Đợt 4: perf — batch-read + M1 parallelize + M4 memo | ✅ **XONG** — 83→85 |

**Tổng:** 85 tools. Commit `082e957` (đợt 1) + `af828f7` (đợt 2) + `8ffaecb` (đợt 3) + `813bf20` (đợt 4). `docs/parity-v2-v3.md` sync: `batchSetProperties` gap đã đóng (nodeBatchSet/sceneBatchGet).

## 1. Mục tiêu

Nâng ccb3x từ 47 tool (granular, vừa thêm escape hatch) → 85 tools hiện tại, giữ hướng "discover → act", mượn funplay ở 3 tầng: **escape hatch an toàn** (done), **vòng verify khép kín** (done), **DX compile+files** (done), **interaction+meta hoàn chỉnh** (done — đợt 3), **perf: batch-read + parallel IPC + memo** (done — đợt 4). Không chạy parity tool-đếm — chỉ mượn thứ mở workflow mới hoặc là pattern kiến trúc.

## 2. Nguyên tắc chọn lọc

| Mượn khi | Không mượn |
|---|---|
| Mở workflow mới (visual verify, fix compile, refactor script, interaction test) | ccb3x đã cover tốt hơn (inspector, animation, asset-db, prefab msg) |
| Pattern kiến trúc tái dùng (guard, envelope, profile) | Kéo dependency nặng (generate_image_asset → SD/DALL-E key) |
| Engine 3.7.3 expose message / Node builtin | Engine 3.7.3 chặn (change-gizmo timeout, project:set-config) |

## 3. Gap matrix — funplay FULL (105) vs ccb3x (85)

Ký hiệu: ✅ cover · ⚠️ một phần · ❌ thiếu

| funplay category (count) | ccb3x hiện có | GAP |
|---|---|---|
| Execution (3) | ✅ `executeJavascript` (gộp 3→1) | — |
| Animation (4) | ✅ `animationQuery/Edit` (giàu hơn) | — |
| Components (7) | ✅ `nodeComponentManage`/`nodeComponentsGet`/`callComponentMethod`/`inspector*`/`nodeReset` | — |
| Selection (3) | ✅ `editorSelect` (7 ops) | — |
| Build (6) | ✅ `buildManage` (tasks/trigger/control) | ⚠️ `run_project_preview`/`get_preview_mode`/`set_preview_mode` |
| Scene (9) | ✅ `nodeCreate`/`nodeOperate`/`nodeGetTree`/`nodeGetAtPath`/`sceneGetInfo`/`sceneManage`/`sceneSnapshot` | ⚠️ `find_nodes` (theo name/component — ccb3x chỉ path) |
| Assets (11) | ✅ `assetCreate`/`assetImport`/`assetOperate`/`assetQuery`/`assetResolvePath`/`assetFindReferences` | ⚠️ `inspect_asset_dependencies` (UUID deps) |
| Prefabs (10) | ✅ `nodeOperate` prefab ops + `readPrefabJson`/`editPrefabJson`/`duplicatePrefab` (file-level) | ⚠️ `inspect_prefab_instance` |
| Diagnostics (5) | ✅ `runScriptDiagnostics`/`getScriptDiagnosticContext` | ⚠️ `validate_scene/asset/prefab` (validateScene done) |
| Files (8) | ✅ `projectReadFile`/`projectWriteFile`/`projectSearchFiles`/`projectReplaceInFile`/`projectFileExists`/`projectListDirectory` | — |
| Screenshots (5) | ✅ `captureSceneScreenshot`/`captureEditorScreenshot`/`listEditorWindows` | ⚠️ `capturePreviewScreenshot`/`captureGameScreenshot` (chưa) |
| Runtime (4) | ✅ `runtimePause`/`runtimeResume`/`runtimeSetTimeScale`/`runtimeGetState` | — |
| Other — perf (2) | ✅ `getPerformanceSnapshot` + `validateScene` | — |
| Input (5) | ✅ `simulateKeyPress`/`simulateKeyCombo`/`simulateMouseClick`/`simulateMouseDrag` (Electron probe) | ⚠️ runtime-gated (fail-fast nếu 3.7.3 không expose webContents) |
| Events (4) | ✅ `simulateButtonClick`/`bindButtonClickEvent` + `callComponentMethod` | — |
| UI (4) | ✅ `createUiNode`/`createLabel`/`createButton`/`createSprite` | — |
| Instructions (5) | ✅ `readProjectInstruction`/`writeProjectInstruction` | — |
| Preferences (2) | ✅ `getEditorPreference`/`setEditorPreference` | — |
| Logs (3) | ⚠️ `editorGetLogs` | ⚠️ `search_project_logs` |
| Broadcast (1) | ⚠️ `callComponentMethod`/`executeJavascript` | — (đủ thay) |
| Updates (1) | ❌ | skip (ngoài phạm vi) |
| **Batch** | ✅ `nodeBatchSet` + `sceneBatchGet`/`assetBatchQuery` (M2) | — |
| **Snapshot** | ✅ `sceneSnapshot` | — |
| **Perf/Memo** | ✅ M1 parallel IPC + M4 L1/L2 memo (60s/5s) | — |

**Chốt:** Đợt 1+2 đã cover Diagnostics, Files, Screenshots (partial), Runtime, Perf/Validate, UI, Batch. Đợt 3 đóng nốt: sceneSnapshot, Events, Prefab JSON, Instructions, Preferences, Input-sim → 83 tools. Đợt 4 (perf): `sceneBatchGet`/`assetBatchQuery` + M1 parallelize (`sceneGetInfo`, `editorViewport` gizmo/viewport, `script_info`, `validateScene`, `assetGetTree`/`assetResolvePath`/`createUiNode`) + M4 TTL memo (L1 definitions 60s, L2 asset query 5s) + verbose convention → 85 tools. Còn lại: `find_nodes` theo name/component, Preview screenshots, Logs search = low priority.

### 3.5 Local source synthesis — các repo MCP có sẵn source

Ngoài funplay, đối chiếu 4 repo local có tool surface (đều là fork/variant `cocos-code-mode`):

| Repo | Tool đăng ký | Bản chất |
|---|---|---|
| `cocos-code-mode` (upstream) | 24 | tổ tiên — granular gốc |
| `cocos-code-mode-custom` | 24 | copy upstream |
| `cc-code-mode-cst` (3x trung gian) | 59 | 3x pre-consolidation (A1 shims) |
| `cc-code-mode-cst-2x` (ccb2x) | 108 (53 thật) | full 2x surface |

`code-mode/`, `rs-utcp/`, `typescript-utcp/`, `utcp-mcp/` = SDK/protocol/client — KHÔNG phải editor tool, bỏ qua.

**Kết luận:**

1. **Consolidation 59→47 KHÔNG mất capability** — granular cũ (`assetGetPreview`/`preview*`/`program*`/`project*`/`build*`/`sceneOpen`) đều map vào `*Manage`/`*Operate`. Xác nhận README "10 consolidated replaces 26 legacy".

2. **Item mới duy nhất giá trị cao từ 2x: `batchSetProperties`** — multi-node batch write. 2x có native, 3x phải loop N lần `inspectorSet` (parity ⚠️). Corroborate với funplay `modify_nodes`/`create_nodes` bulk → 2 nguồn cùng xác nhận. **Setup:** mở rộng `inspectorSet` nhận `references[]` (multi-target) hoặc tool mới `nodeBatchSet`, loop `set-property` + 1 `snapshot` cuối. Effort M. **P1.**

3. **`sceneSnapshot`** (2x) — full serialized scene dump (unbounded, giàu hơn `nodeGetTree` transform/size/components). Use-case: "đưa toàn bộ scene state" / diff. Setup: `query-node-tree` không bound + dump đầy đủ props. Effort S. **P2.**

4. **Engine-limited đã xác nhận (không port được):** `assetExchangeUuid` (❌ msg), `projectSaveConfig` (❌ msg), `editorSelect` set_context/patch/filter (❌ module selection 3.7), `assetResolve` 4 ops phụ (backlog).

5. **Pattern insight:** 2x có `nodeSetPropertyUndo` (undo explicit); 3x bỏ bằng `snapshot()` implicit — 3x sạch hơn, giữ nguyên.

## 4. Setup plan — từng cluster

| # | Cluster | Tool | Setup (API/msg) | File mới | Effort | 3.7.3 risk | Ưu tiên |
|---|---|---|---|---|---|---|---|
| 1 | **Diagnostics** | `runScriptDiagnostics` + `getScriptDiagnosticContext` | `child_process.spawn('npx', ['tsc','--noEmit','-p',tsconfig])` → parse JSON; snippet ±3 dòng | `tools/diagnostics-tools.ts` + `utils/tsc-runner.ts` | M | thấp (subprocess thuần) | **P1** |
| 2 | **Files** | `readFile/writeFile/searchFiles/replaceInFile/exists/listDirectory/getFileSnippet` | `fs-extra` + `path-safety.isPathInside` (đã có); sau write `asset-db refresh-asset` | `tools/file-tools.ts` | M | thấp | **P1** |
| 3 | **Screenshots** | `captureEditor/Scene/Game/PreviewScreenshot` + `listEditorWindows` | `require('electron').desktopCapturer` + `BrowserWindow.capturePage()` | `tools/screenshot-tools.ts` | L | **CAO — probe trước** | P2 |
| 4 | **Runtime** | `pauseRuntime/resumeRuntime/setTimeScale/getRuntimeState` | scene handler: `cc.director.pause()/resume()` + `getScheduler().setTimeScale()` | `scene.ts` + `tools/runtime-tools.ts` | S | thấp | **P1** |
| 5 | **Perf/Validate** | `getPerformanceSnapshot` + `validateScene` | walk `query-node-tree` đếm node/comp/UI/depth; `validateScene` gộp scene+runtime+diagnostics+logs | `tools/validation-tools.ts` | M | thấp | P2 |
| 6 | **UI helpers** | `createCanvas/createLabel/createButton/createSprite` | `create-node` + prefab URL `db://internal/default_prefab/ui/*.prefab` (như `nodeCreatePrimitive`) | `tools/ui-tools.ts` | S | thấp | **P1** (slot 2D) |
| 7 | **Events** | `simulateButtonClick` + `bindButtonClickEvent` | scene handler: tìm `cc.Button`, emit click / gán handler | `scene.ts` + `tools/event-tools.ts` | S | thấp | P2 |
| 8 | **Prefab JSON** | `editPrefabJson` + `duplicatePrefab` | fs read/write `.prefab` + validate UUID qua `query-asset-info` | `tools/prefab-json-tools.ts` | M | thấp | P3 |
| 9 | **Instructions** | `readProjectInstruction/writeProjectInstruction` | fs AGENTS.md/CLAUDE.md/.codex | `tools/instruction-tools.ts` | S | thấp | P3 |
| 10 | **Preferences** | `getEditorPreference/setEditorPreference` | `Editor.Profile.getConfig/setConfig` | `tools/preference-tools.ts` | S | thấp | P3 |
| 11 | **Input sim** | `simulateKeyCombo/keyPress/mouseClick/mouseDrag` | Electron `webContents.sendInputEvent` | `tools/input-tools.ts` | L | **CAO — probe trước** | P3 |

## 5. Thứ tự ưu tiên — quan trọng/hữu ích trước

Xếp hạng theo `value = impact × (1/effort) × (1/risk)`, ưu tiên thứ **đóng vòng lặp** AI dev slot-game:

```
viết code ─► check compile ─► sửa ─► thấy kết quả ─► lặp
```

### Đợt 1 — đóng vòng "code → compile → fix" (build ngay, risk thấp)

| # | Tool | Vì sao trước | Effort | Risk |
|---|---|---|---|---|
| 1 | `runScriptDiagnostics` + `getScriptDiagnosticContext` | AI sinh TS hay lỗi compile — nút thắt #1 mọi workflow code-gen | M | thấp |
| 2 | `readFile/writeFile/searchFiles/replaceInFile` | refactor + đọc non-asset; pair #1 → vòng fix-compile khép kín | M | thấp |
| 3 | `createCanvas/createLabel/createButton/createSprite` | slot game UI-heavy — task "build panel" phổ biến nhất | S | thấp |
| 4 | `pauseRuntime/resumeRuntime/setTimeScale` | test logic game, rẻ nhất trong list | S | thấp |

Kèm đợt 1, chạy song song (không chặn): **spike probe Electron** → quyết định #5 (screenshots) khả thi không.

### Đợt 2 — đóng vòng "thấy kết quả" + tăng tốc (sau khi ~53 tool)

| # | Tool | Vì sao | Effort | Risk |
|---|---|---|---|---|
| 5 | Screenshots `captureEditor/Scene/Game/Preview` | visual verify — đóng vòng "có đúng không" | L | CAO (probe) |
| 6 | `batchSetProperties` | bulk multi-node — build UI hàng loạt | M | thấp |
| 7 | `getPerformanceSnapshot` + `validateScene` | health check scene | M | thấp |

**Gate trước đợt 2:** tool profiles (core/full) — ở 53+ tool, LLM thấy quá nhiều tool def gây noise.

### Đợt 3 — nice-to-have → ✅ **XONG** (83 — 69→83)

| # | Tool | Vì sao | Trạng thái |
|---|---|---|---|
| 8 | `simulateButtonClick` + `bindButtonClickEvent` | test interaction UI | ✅ `scene.ts` + `event-tools.ts` |
| 9 | `sceneSnapshot` | full dump/diff | ✅ `scene-snapshot-tools.ts` |
| 10a | Prefab JSON (`readPrefabJson`/`editPrefabJson`/`duplicatePrefab`) | file-level prefab | ✅ `prefab-json-tools.ts` |
| 10b | Instructions (`readProjectInstruction`/`writeProjectInstruction`) | AGENTS.md/CLAUDE.md | ✅ `instruction-tools.ts` |
| 10c | Preferences (`getEditorPreference`/`setEditorPreference`) | Editor.Profile | ✅ `preference-tools.ts` |
| 10d | Input-sim (`simulateKeyPress/Combo/mouseClick/mouseDrag`) | Electron webContents probe | ✅ `input-tools.ts` (fail-fast nếu 3.7.3 không expose) |

### Đợt 4 — perf (batch-read + M1 parallelize + M4 memo) → ✅ **XONG** (83→85)

| # | Item | Gì | File |
|---|---|---|---|
| M2 | `sceneBatchGet` + `assetBatchQuery` | 1 HTTP thay N (`Promise.allSettled` + `fields` filter, qs-safe) | `batch-read-tools.ts` (POST) |
| M1 | `sceneGetInfo` / `editorViewport` query_gizmo/viewport / `script_info` / `validateScene` / `assetGetTree` parallel | 3-5 round → 1 round (Promise.all) | `scene-tools.ts`, `editor-tools.ts`, `validation-tools.ts`, `asset-tools.ts` + `ui-tools.ts` (`createUiNode`) |
| M4 | `definitionMemo` L1 (60s) + `assetQueryMemo` L2 (5s) + invalidate on writes | near-static TTL memo, eviction-cap 256 | `utils/memo-cache.ts`, `typescript-defenition.ts`, `asset-tools.ts` |
| M1 | timing middleware + X-Duration-Ms + json 50mb + body merge (qs + body) | measure + large payload | `utcp-server.ts` |
| — | `verbose=true` lift caps for capped tools | compact default, full on demand | `utils/verbose.ts` + `scene-tools.ts`/`asset-tools.ts`/`file-tools.ts`/`diagnostics-tools.ts`/`prefab-json-tools.ts`/`instruction-tools.ts` |

### Foundation (không phải tool, chèn theo thời điểm)

| Item | Khi nào | Lý do |
|---|---|---|
| Tool profiles (core/full) | trước đợt 2 | chặn context bloat ở 53+ tool |
| Result envelope + auto-refs | đầu đợt 2 | đổi output contract sớm để khỏi retrofit |

**ĐÃ XONG:** safety layer + `executeJavascript` (escape hatch).

## 6. Kiến trúc nền còn thiếu (không phải tool)

1. **Result envelope + auto-refs** — mọi tool trả `{ ok, tool, callId, summary, data, refs[] }`, `refs` auto-collect từ result (uuid/url/path, depth≤5). Giảm round-trip "tìm id" cho agent. Mượn funplay `createResultEnvelope`/`collectRefs`.
2. **Tool profiles (core/full) + annotations** (`readOnly/stateful/mutating`) — graduated exposure + security tiering. Mượn funplay `tool-profiles.js` + `inferToolAnnotations`.

Cả 2 là foundation, nên làm trước khi thêm ồ ạt tool mới — để surface 60+ tool không làm nghẹt context LLM.

## 7. Quyết định cần chốt

1. **`executeJavascript` opt-in hay default-on?** (đã chốt opt-in qua `safety_checks` default ON; profile gating chờ #6.2)
2. **Filesystem: raw fs hay asset-db scoped?** → đề xuất: asset-db cho asset, raw-fs riêng cho non-asset (script .ts, AGENTS.md) + `path-safety` + auto `refresh-asset`.
3. **Screenshot/input-sim có chấp nhận probe-spike trước không?** Electron API trong editor 3.7.3 chưa verify.

## 8. Rủi ro

| Rủi ro | Mức | Mitigate |
|---|---|---|
| `executeJavascript` mất kiểm soát | Cao | safety layer (done) + opt-in + profile gating |
| Screenshot/input-sim Electron không expose trong 3.7.3 | Cao | probe trước, gate đóng nếu fail |
| Raw fs lệch asset-db cache | Trung | auto `refresh-asset` sau write |
| 60+ tool nghẹt context LLM | Trung | profile core/full (#6.2) trước khi ồ ạt thêm |

## 9. Chưa rõ

- `tsc --noEmit` spawn trong editor main process có khả dụng không (node version, `npx` path)? Cần spike #1.
- `require('electron').desktopCapturer`/`sendInputEvent` có hoạt động trong editor 3.7.3 main process không? Probe #3/#11.
- `runCode` scene context: `require` có resolve `fs` trong scene panel 3.7.3 không? (đang guard — cần test thật.)
- Đăng ký plan lên central kanban (Notes vault) hay giữ local `plans/` đủ?
