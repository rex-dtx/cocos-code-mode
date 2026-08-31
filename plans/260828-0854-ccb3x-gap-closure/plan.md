# ccb3x Gap Closure — parity + funplay leftover (2-3 tasks, T2)

> **Ngày:** 2026-08-28 · **Branch:** `cc-3x7` · **Type:** gap-closure / T2
> **Trạng thái:** DONE — G1 ✅ · G2 ✅ (NOT-EXPOSED, không implement) · G3 ✅; live smoke trên build `f249e87` xác nhận 86 tools, 8 pass / 0 fail / 0 skip; parity doc đã đồng bộ

## 0. Bối cảnh

- 85 tools hiện tại đã đóng 4 đợt (47→85). Scan `@utcpTool` trực tiếp ngày 2026-08-27:
  - `cc-3x7`: 85 unique (85 regs = 84 `tools/*.ts` + `executeJavascript`)
  - `origin/cc-2x`: 78 unique (102 regs, giữ cả legacy chưa gom)
  - Chung: 34 · Chỉ 3x7: 51 · Chỉ 2x: 44
- 44 chỉ-2x nhìn nhiều nhưng 37 đã được gom vào 10 consolidated (`buildManage`, `assetOperate`, `programManage`, `projectManage`, `previewManage`, `sceneManage`, `nodeComponentManage`, `nodeOperate`, `inspectorSet`, `editorQuery`…) — `docs/parity-v2-v3.md` đã map.
- Sau khi trừ consolidated → **7 uncovered thực sự**, trong đó 2 đã đóng (`assetSaveMeta` → `assetOperate save_meta` @`78c6315`, `batchSetProperties` → `nodeBatchSet`+`sceneBatchGet`), 3 chặn engine vĩnh viễn, chỉ còn 2-3 việc làm được.
- `parity-v2-v3.md` đã sync header 85 vs 53 @`8c08955` nhưng 53 là số “effective” cũ (2x trước khi đếm raw 78); không cần sửa lại ngay — ghi chú ở §7.
- Funplay matrix (§3 của plan 260825) còn 3 ⚠️ P3 low: `find_nodes` theo name/component, Preview screenshots, Logs search.

**Mục tiêu plan này:** đóng nốt 2-3 việc khả thi còn lại, mỗi việc ≤1 file, không đụng engine limit. Không mở lại 3 plan DONE trước đó.

## 1. Gap inventory — đã phân loại

| # | Nguồn | Mục | Trên 3x7 hiện tại | Khả thi 3.7.3? | Kết luận |
|---|-------|-----|-------------------|---------------|----------|
| G1 | parity #5 | `assetResolve` 4 ops phụ: `is_sub_asset` / `contains_sub_assets` / `relative_path` / `backup_path` | `assetResolvePath` chỉ có uuid/url/fspath/exists/type — thiếu 4 | **Làm được ngay** — `asset-db/query-asset-info` `doc` trả `AssetInfo` có `isSubAsset`; `query-path`/`query-url` đã dùng; `relative_path` = `path.relative(projectPath, fspath)`; `backup_path` = `fspath + .meta` suy ra từ fs | **P1** |
| G2 | parity #6 | `sceneNew` (`scene:new-scene`) | Chưa có — workaround `assetCreate {scene}` + `sceneManage open` đã ghi | **Probe trước** — `grep scene:new-scene` = 0 hit trong registry 416 msg; `origin/cc-2x` gọi `sendToPanel('scene','scene:new-scene')` fire-and-forget (không chờ reply). Cần probe như `probeSceneIpc` đã làm cho 14 `scene:*` trước khi quyết | **P2** |
| G3 | funplay Scene | `find_nodes` theo name / component | `nodeGetTree` + client filter đã có (`findNodesByAsset`/`WithMissingAssets` làm mẫu) | **Làm được** — walk tree đã có, thêm filter `name`/`componentType` | **P3** |
| G4 | funplay Logs | `search_project_logs` | `editorGetLogs` đã có, thiếu search/filter | **Làm được nhưng low value** — `projectSearchFiles` + `editorGetLogs` đã cover 80% | **P3 backlog** |
| G5 | funplay Screenshots | `capturePreviewScreenshot` / `captureGameScreenshot` | `captureScene/EditorScreenshot` đã có | **Cao risk** — cần preview runtime / simulator `webContents`, chưa verify trên 3.7.3 | **Không làm trong plan này** |
| — | parity #2/#3 | `projectSaveConfig` / `assetExchangeUuid` | `unsupported` / không có message | **Chặn cứng** — registry không có `project:set-config` / `exchange-uuid`; `assetExchangeUuid` 2x dùng `Editor.assetdb.exchangeUuid` sync API không tồn tại ở 3.x | **Không port** — giữ quyết định “bỏ tool > map sai” |
| — | parity #4 | `editorSelect` set_context/patch/filter/confirm/cancel | 7 ops hiện tại | **Chặn** — không có module `selection` trong registry (20 module, không có `selection`) | **Backlog khi agent cần** |

## 2. Phạm vi plan này

**Làm:** G1 + G2 (probe) + G3 — 3 task, mỗi task 1 file, tổng <100 dòng mới.
**Không làm:** G4/G5 (P3 low), 3 mục chặn cứng, và toàn bộ 3 plan DONE trước đó.

## 3. Thiết kế

### G1 — mở rộng `assetResolvePath` (P1)

**Hiện tại** `source/utcp/tools/asset-tools.ts:assetResolvePath` trả 7 key: `filesystemPath/url/uuid/exists/isDirectory/type/importer`.

**Thêm 4 field (opt-in, backward compat):**
- `isSubAsset?: boolean` — từ `AssetInfo.isSubAsset` (đã có trong `query-asset-info` result)
- `containsSubAssets?: boolean` — `Array.isArray(AssetInfo.subAssets) && subAssets.length > 0`
- `relativePath?: string` — `path.relative(Editor.Project.path, filesystemPath)` (chỉ khi có `filesystemPath`)
- `backupPath?: string` — `filesystemPath + '.meta'` tồn tại check `fs.existsSync` (asset 2x dùng `assetdb.backupPath` tương tự)

Không thêm `mount_info` — đã có `assetDbQuery databases/db_info`.

**Schema:** thêm 4 optional properties vào outputs, không đổi inputs. Không cần enum `operation` mới — trả thêm field luôn (như `isDirectory` đã làm).

**File:** `source/utcp/tools/asset-tools.ts` — sửa `assetResolvePath` (~15 dòng).

### G2 — probe `scene:new-scene` (P2)

**Trước khi code:** chạy probe ngắn (như `probeSceneIpc` đã làm cho 14 `scene:*`):
- Gửi `Editor.Message.request('scene','new-scene')` hoặc `sendToPanel('scene','scene:new-scene')` từ main process với timeout 3s.
- Phân loại: `exists` (reply) / `no-reply` (fire-and-forget như 2x) / `timeout` / `not-found`.

**Kết quả:**
- Nếu `exists`/`no-reply` → thêm op `new` vào `sceneManage` (fire-and-forget như 2x `sceneNew`, note “verify with sceneGetInfo”).
- Nếu `not-found`/`timeout` → giữ workaround `assetCreate {scene}` + `sceneManage open`, ghi vào `docs/parity-v2-v3.md` là “engine không expose”.

**File:** probe script `scripts/probe-scene-new.js` (tạm, xóa sau) + nếu pass thì `source/utcp/tools/consolidated-tools.ts:sceneManage`.

**KẾT QUẢ PROBE (2026-08-28, Creator 3.7.3 live, paste vào Editor Console):**

```
[probe] new-scene            => Message does not exist: scene - new-scene
[probe] query-current-scene  => reply 80dddede-15e3-4d8e-8f37-0f1263a0867c   (control OK)
[probe] sendToPanel          => Cannot read property 'sendToPanel' of undefined (console renderer, không ảnh hưởng kết luận)
```

→ **G2 = NOT-EXPOSED.** `Editor.Message.request('scene','new-scene')` báo "Message does not exist" (đường chuẩn, control `query-current-scene` reply bình thường). Registry cũng 0 hit. **Quyết định: KHÔNG thêm op `new` vào `sceneManage`; giữ workaround `assetCreate {scene}` + `sceneManage open` và ghi ❌ vào `parity-v2-v3.md`.**

### G3 — `find_nodes` theo name/component (P3)

**Chọn 1 trong 2:**
- (A) Thêm op cho `findNodesByAsset`-family: tool mới `findNodes` với filter `{name?, componentType?}` walk `nodeGetTree` in-memory.
- (B) Mở rộng `editorQuery` hoặc `sceneManage` — không phù hợp (đây là query, không phải lifecycle).

**Đề xuất (A):** tool mới `findNodes` hoặc mở rộng `findNodesByAsset` thành `findNodes` generic. Đặt cạnh `findNodesByAsset` trong `source/utcp/tools/scene-tools.ts` để reuse walk logic.

**Schema:** `{ name?: string, componentType?: string }` (ít nhất 1), trả `nodes: Array<{reference, name, path}>`.

## 4. Thứ tự & effort

| Task | File | Effort | Risk | Phụ thuộc |
|------|------|--------|------|-----------|
| G1 `assetResolvePath` +4 fields | `asset-tools.ts` | S (15 dòng) | thấp | không |
| G2 probe `scene:new-scene` | `scripts/probe-scene-new.js` + `consolidated-tools.ts` nếu pass | XS probe + S nếu implement | thấp (probe), trung nếu implement | không |
| G3 `findNodes` by name/component | `scene-tools.ts` | S (30 dòng) | thấp | không |

3 task độc lập, làm song song được. Tổng <80 dòng mới.

## 5. Rủi ro & mitigate

| Rủi ro | Mitigate |
|--------|----------|
| `AssetInfo.isSubAsset` không có trên 3.7.3 (registry doc ngắn, không liệt kê fields) | Guard `inf?.isSubAsset ?? false`; probe trên editor 3.7.3 thật trước khi merge |
| `scene:new-scene` timeout nhưng thực ra là fire-and-forget (2x cũng không await) | Probe cả `request` và `sendToPanel` hai đường; nếu cả hai không reply thì coi là “không expose” |
| `findNodes` walk toàn tree chậm ở scene lớn | Dùng `maxDepth`/`maxNodes` đã có ở `nodeGetTree` làm bound |

## 6. Verify

- `npm run typecheck` + `npm run build` pass.
- Smoke: `curl /utcp` trả 85→86 tools (nếu thêm G3) hoặc giữ 85 (nếu chỉ G1).
- G1: `assetResolvePath` cho sub-asset → `isSubAsset:true`, `containsSubAssets` đúng.
- G2: probe log phân loại rõ `not-found` vs `no-reply`.
- G3: `findNodes {name:"Main Camera"}` trả đúng node.

## 7. Ghi chú parity

- `parity-v2-v3.md` header 85 vs 53: 53 là “effective” cũ (2x @`8a80bf5` sau khi đếm consolidated), raw hiện tại 78 unique (102 regs). Không sửa header vội — chờ chốt G1-G3 rồi sync một lần.
- Sau khi xong G1-G3, sync `parity-v2-v3.md` §“Chỉ v2 có (37)”: đánh G1 thành ✅, G2 thành ✅ hoặc ❌ tùy probe, và cập nhật Gap #5.

## 8. Ngoài scope (ghi nhận, không làm)

- `assetExchangeUuid` / `projectSaveConfig` — chặn engine, không port (quyết định đã chốt ở `docs/cocos-3x7-api-drift.md`).
- `capturePreview/GameScreenshot` — cần preview runtime, probe riêng nếu sau này cần.
- `search_project_logs` — low value, `editorGetLogs` + `projectSearchFiles` đã đủ.

## 9. Tổng kết (2026-08-28)

| Gap | Kết quả | Code |
|-----|---------|------|
| G1 `assetResolvePath` +4 | ✅ DONE | `asset-tools.ts:96-143` — `isSubAsset/containsSubAssets/relativePath/backupPath` |
| G2 `scene:new-scene` probe | ✅ DONE — NOT-EXPOSED | `scripts/probe-scene-new.js` + registry 0/191 — giữ workaround `assetCreate {scene}` |
| G3 `findNodes` | ✅ DONE | `scene-tools.ts` — `findNodes` trước `nodeReset` — 86 regs |

`npx tsc --noEmit` pass. Build `8c08955-dirty` (86 regs). Editor đang chạy bản cũ 46 tools — cần restart/reload extension để lên 86 trước khi smoke. Parity doc sync ở lần commit kế.
