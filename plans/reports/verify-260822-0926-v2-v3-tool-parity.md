# Parity v2 ↔ v3 — tool surface + thay thế

**Ngày:** 2026-08-22 · **v3** `cc-bridge-3x` branch `cc-3x7` @`416fcb1` = **46 tools** · **v2** `cc-bridge-2x` branch `cc-2x` = **53 tools**
**Nguồn:** parse `@utcpTool()` từ `source/utcp/tools/` (3x) và `source/utcp/tools-2x/` (2x, 13 file registered ở `utcp-server.ts:19-31`) + `docs/cc-3x7-message-registry.json` (416 msg / 20 module, dump 3.7.3).
**Bổ sung cho:** `verify-260821-0939-cc3x7-api.md` (coverage message 131/416) — file này chỉ lo parity 2 chiều, không lặp lại.

## 1. Tổng quan

| | Cùng tên | Chỉ 3x | Chỉ 2x |
|---|---|---|---|
| Số tool | 16 | 30 | 37 |

Tên khác nhau **không** đồng nghĩa thiếu chức năng: 3x gom thành 10 consolidated (`*Manage`/`*Operate`/`inspector*`), 2x giữ standalone. Sau khi map ops:

- **Có thay thế đầy đủ:** 3x thiếu 24/37 tool của 2x nhưng có tool khác cover; 2x thiếu 18/30 của 3x có cover.
- **Gap thật (không thay thế được):** 3x 2 mục · 2x 4 mục.
- **Gap sửa được ngay:** 3x 1 mục (`assetSaveMeta` — message có sẵn trong registry).

## 2. Cùng tên nhưng lệch ops

| Tool | 3x | 2x | Kết luận |
|---|---|---|---|
| `animationQuery` | 10 ops (`root_info/root/edit_info/clips_info/clip_dump/properties/state/current_info/clip_time/value_at_frame`) | 4 (`clips_info/clip_dump/properties/state`) | 2x thiếu 6 ops — port được (ledger #2) |
| `animationEdit` | 8 (`record_start/stop/change_root/set_edit_clip/set_edit_time/clip_state/save_clip/operate`) | 4 (`record_start/stop/save_clip/operate`) | 2x thiếu 4 ops |
| `editorSelect` | 7 (`select/unselect/clear/query/select_all/hover/update`) | 10 (`query/select/unselect/clear/hover/set_context/patch/filter/confirm/cancel`) | **2 chiều**: 3x thiếu `set_context/patch/filter/confirm/cancel` (3.7 `selection` module không có msg tương ứng), 2x thiếu `select_all/update` |
| `nodeClipboard` | `copy/cut/paste` | + `duplicate` | 3x `duplicate` → `nodeOperate copy` (dùng `duplicate-node`) ✅ |
| `assetQuery` | filter-based (glob/ccType/importer/extname/isBundle) | 8 ops umbrella (`search/tree/info/meta/types/sub_assets/used_by/metas`) | Tương đương sau khi cộng `assetGetTree`+`assetResolvePath`+`assetFindReferences`+`editorQuery asset_types` |

## 3. Chỉ 3x có (30) — 2x thay thế bằng gì

| 3x tool | 2x thay thế | Trạng thái |
|---|---|---|
| `assetGetAtPath` | `assetResolve uuid_from_url` | ✅ |
| `assetGetTree` | `assetQuery tree` | ✅ |
| `assetSaveContent` | `assetWriteContent` | ✅ |
| `assetResolvePath` | `assetResolve` (2x giàu hơn: +`is_sub_asset/contains_sub_assets/mount_info/relative_path/backup_path`) | ✅ (3x mới là bên yếu) |
| `assetOperate` move/delete/refresh | `assetMove` / `assetDelete` / `assetRefresh` | ✅ |
| `assetOperate` copy/open/reimport | `assetReadContent`+`assetWriteContent` / `programOpen` / `assetRefresh` | ⚠️ workaround |
| `assetFindReferences` used_by | `assetQuery used_by` | ✅ |
| `assetFindReferences` depends_on | — | ⚠️ thiếu (2.4 không có `query-asset-dependinces`) |
| `assetCreate` (16 kiểu) | `assetCreateFolder` + `assetWriteContent` | ⚠️ folder/text OK, asset có template (material/effect/anim-clip/render-texture) phải tự viết content |
| `editorHistory` | `editorUndo` | ✅ |
| `editorQuery` creatable_assets/asset_types/importers | `editorListTypes` (3 ops) | ✅ |
| `editorQuery` scene_mode/ready/enum_values/layers/sorting_layers/script_info/has_script | `sceneInfo` (một phần) | ⚠️ thiếu 7 ops |
| `editorViewport` (12 ops gizmo/2d/align) | — | ❌ **gap** — 2.4 có `scene:change-gizmo-*` nhưng Probe 4: 14/14 timeout (fire-and-forget) |
| `findNodesByAsset` | `sceneSnapshot` + filter client-side | ⚠️ workaround |
| `findNodesWithMissingAssets` | `sceneSnapshot` + scan null ref | ⚠️ workaround |
| `inspectorGet` | `nodeQuery dump` + `componentQuery props` | ✅ |
| `inspectorSet` | `nodeSetProperty` / `nodeSetPropertyUndo` | ✅ |
| `inspectorGetDefinition` (gen TS d.ts runtime) | file tĩnh `cc-bridge-2x.d.ts` | ✅ khác cơ chế, cùng nhu cầu |
| `listComponentClasses` · `nodeGetAvailableComponentTypes` · `nodeComponentsGet` | `componentQuery classes` / `props` | ✅ |
| `nodeGetTree` · `nodeGetAtPath` | `nodeQuery tree` / `at_path` · `sceneSnapshot` | ✅ |
| `nodeOperate` move/copy/delete/apply_prefab | `nodeMove` / `nodeDuplicate` / `nodeRemove` / `prefabSync` | ✅ |
| `nodeOperate` lock/unlock + create/link/revert/unwrap/open_prefab | — | ❌ **gap** — `scene:*` prefab IPC timeout (Probe 4) |
| `previewManage` (4 ops) | `previewGetUrl` + `previewOpenInBrowser` + `assetGetPreview` + `editorGetScenePreview` | ✅ 1:4 |
| `programManage` (3 ops) | `programGetInfo` + `programOpen` + `urlOpen` | ✅ 1:3 |
| `projectManage` get | `projectGetConfig` | ✅ |
| `sceneGetInfo` | `sceneInfo` | ✅ |
| `sceneManage` open/save | `sceneOpen` / `editorOperate save_scene` | ✅ |
| `sceneManage` save_as/close/soft_reload | — | ⚠️ thiếu |
| `propertyArrayElement` (remove/move phần tử array) | `nodeSetProperty` toàn array (read-modify-write) | ⚠️ workaround, không atomic |
| `assetDbQuery` (databases/busy/mtime/data/db_info) | `assetResolve mount_info` (một phần) | ⚠️ thiếu busy/mtime/raw data |
| `materialQuery` (effects/effect/material/serialized/render_pipeline/physics_material) | `assetReadContent` file `.mtl` | ❌ **N/A engine** — 2.4 không có effect/render-pipeline API |
| `buildManage` (5 ops) | — | ❌ **N/A engine** — 2.4 Build panel không expose qua bridge |

## 4. Chỉ 2x có (37) — 3x thay thế bằng gì

| 2x tool | 3x thay thế | Trạng thái |
|---|---|---|
| `assetCreateFolder` | `assetCreate {folder}` | ✅ |
| `assetDelete` · `assetMove` · `assetRefresh` | `assetOperate delete/move/refresh` | ✅ |
| `assetWriteContent` | `assetSaveContent` | ✅ |
| `assetGetPreview` | `previewManage asset_preview` | ✅ |
| `editorGetScenePreview` | `previewManage scene_preview` | ✅ |
| `previewGetUrl` · `previewOpenInBrowser` | `previewManage get_url/open_browser` | ✅ |
| `programGetInfo` · `programOpen` · `urlOpen` | `programManage get_info/open/open_url` | ✅ (`open` map `execute`, `open_url` map `execFile` http(s) — 3.7.3 không có `open-program`/`open-url`) |
| `editorListTypes` | `editorQuery creatable_assets/asset_types/importers` | ✅ |
| `editorOperate` | `sceneManage save` + `assetOperate refresh` | ✅ |
| `editorUndo` | `editorHistory` | ✅ |
| `componentQuery` | `nodeComponentsGet` + `listComponentClasses` + `findNodesByAsset` | ✅ |
| `nodeQuery` | `nodeGetTree` + `nodeGetAtPath` + `inspectorGet` + `listComponentMethods` | ✅ |
| `sceneSnapshot` | `nodeGetTree` (transform/size/components) | ✅ |
| `nodeSetProperty` · `nodeSetPropertyUndo` · `sceneSetPropertyHL` | `inspectorSet` (3.x write undo-aware native qua `snapshot`) | ✅ |
| `sceneCreateNodeHL` | `nodeCreate` | ✅ |
| `nodeRemove` · `nodeMove` · `nodeDuplicate` | `nodeOperate delete/move/copy` | ✅ |
| `prefabSync` | `nodeOperate apply_prefab` | ✅ |
| `sceneOpen` · `sceneInfo` | `sceneManage open` · `sceneGetInfo` | ✅ |
| `projectGetConfig` | `projectManage get` | ✅ |
| `assetResolve` core (uuid/url/fspath/exists) | `assetResolvePath` | ✅ |
| `assetResolve` mount_info | `assetDbQuery databases/db_info` | ✅ |
| `assetResolve` is_sub_asset/contains_sub_assets/relative_path/backup_path | — | ⚠️ thiếu (registry có `query-asset-info.isSubAsset` → mở rộng được) |
| `batchSetProperties` (multi-node) | `inspectorSet` (single-target multi-path) → loop N lần | ⚠️ workaround |
| `sceneNew` | `assetCreate {scene}` + `sceneManage open` | ⚠️ workaround (3.7.3 không có `new-scene`) |
| `assetSaveMeta` | — | 🔧 **sửa được ngay** — `asset-db:save-asset-meta` CÓ trong registry, đã dùng nội bộ ở 12 importer, chỉ chưa expose thành tool |
| `projectSaveConfig` | `projectManage set` → báo `unsupported` | ❌ **gap** — 3.7.3 registry không có `project:set-config` (2x mạnh hơn) |
| `assetExchangeUuid` | — | ❌ **gap** — không có message `exchange-uuid` nào trong 416 msg của 3.7.3 |
| `sceneScript` (gọi bất kỳ scene-script handler) | `callComponentMethod` (chỉ component method) | ⚠️ escape hatch 2x-only, cố ý |
| `probeSceneIpc` (probe 14 `scene:*`) | — | ✅ N/A by design — công cụ chẩn đoán 2x, gate đã đóng |

## 5. Gap thật — cần quyết định

| # | Bên thiếu | Mục | Nguyên nhân | Đề xuất |
|---|---|---|---|---|
| 1 | 3x | `assetSaveMeta` | chỉ chưa expose | **Làm** — thêm op `save_meta` vào `assetOperate`, ~10 dòng |
| 2 | 3x | `projectManage set` | 3.7.3 không có `project:set-config` | Giữ `unsupported` (map bừa = ghi sai key im lặng) |
| 3 | 3x | `assetExchangeUuid` | không có message | Không port |
| 4 | 3x | `editorSelect` set_context/patch/filter/confirm/cancel | `selection` module 3.7 không có | Backlog, chỉ mở khi agent cần |
| 5 | 3x | `assetResolve` 4 op phụ | mở rộng được từ `query-asset-info` | Backlog (đã ghi ở report 260821) |
| 6 | 2x | `editorViewport` | `scene:change-gizmo-*` timeout | Chặn cứng — chờ hướng khác |
| 7 | 2x | `nodeOperate` lock/prefab ops | `scene:*` prefab IPC timeout | Chặn cứng |
| 8 | 2x | `buildManage`, `materialQuery` | 2.4 không có API | N/A vĩnh viễn |
| 9 | 2x | `editorQuery` 7 ops, `animation*` 10 ops, `sceneManage` save_as/close/soft_reload, `propertyArrayElement`, `findNodesWithMissingAssets`, `assetCreate` typed | chưa port, có đường làm | Ledger P2 — ưu tiên `editorQuery` + `animation*` |

## 6. Chốt

**Menu + 7 handler:** đã parity sau `416fcb1` (2 top-level + Debug 5 con, `About` gộp port/config/url + build info, `show-info` giữ làm alias).

**Tool surface:** không bản nào là superset. 3x mạnh về inspector/viewport/build/material/prefab-ops; 2x mạnh về asset-db sync (`assetResolve` 10 ops, `saveMeta`, `exchangeUuid`), `projectSaveConfig`, `batchSetProperties`, escape hatch `sceneScript`. Chênh lệch còn lại **hầu hết là engine limit hai chiều**, không phải nợ code — trừ 1 mục (`assetSaveMeta` trên 3x) sửa được ngay.

## Unresolved

1. Có làm `assetSaveMeta` cho 3x luôn không (10 dòng, cần editor 3.7.3 để smoke)?
2. `editorQuery` 7 ops + `animation*` 10 ops port sang 2x — ưu tiên trước hay để sau `1-wip-260821__260829-cc-cache-and-batch`?
3. Ledger `1-wip-260819__tbd-cc-sync-backlog` P2 đang ghi 8/13 — bảng §5 này thêm 4 dòng mới, có merge vào ledger không?
