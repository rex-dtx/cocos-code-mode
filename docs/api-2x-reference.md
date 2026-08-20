# API Reference 2.4.x — doi chieu forum + verified runtime

Nguon chinh: https://forum.cocos.org/t/topic/92605/5 — tong hop API editor 2.x ma community thu thap (asset-db, selection, scene, IPC). File nay doi chieu tung nhom voi `cocos-2x-api-notes.md` (verified tren 2.4.15) va surface thuc te `source/utcp/tools-2x/*.ts` (53 tool).

> Doc truoc khi them tool moi. Forum la ban do, verified notes la su that runtime — khi lech, tin runtime.

---

## 1. Asset DB — `Editor.assetdb` (main process, sync + callback)

### 1.1 API forum + docs chính thống vs verified

> **Cập nhật 2026-08-20:** Bổ sung chi tiết từ docs chính thống `asset-db-renderer` / `asset-db-main` / `asset-management` (fetch trực tiếp) và forum reply #41. Forum 92605 là snapshot, docs chính thống là đầy đủ — khi lệch, tin docs chính thống cho API shape, tin verified runtime cho behavior thực tế.

#### Renderer API (`asset-db-renderer`) — ĐỪNG gọi từ main process

| API | Docs chính thống | Verified | Tool 2x |
|---|---|---|---|
| `queryInfoByUuid(uuid, cb)` → `info.path/url/type` | renderer-only | **RENDERER-only** | — |
| `queryMetaInfoByUuid(uuid, cb)` → `info.assetPath/metaPath/metaMtime/json` | renderer-only | **RENDERER-only** | — |
| `queryPathByUrl/queryUuidByUrl/queryPathByUuid/queryUrlByUuid` | renderer, callback | renderer-only | — |
| `explore(url)` / `exploreLib(url)` | renderer | renderer-only | — |
| `queryAssets(pattern, assetTypes, cb)` vs main `queryAssets` | renderer có `children` trong `deepQuery` result | main `queryAssets` sync-style khác | main `assetQuery search` dùng main `queryAssets` |
| `create / move / delete / saveExists / createOrSave / saveMeta / import / refresh` (renderer) | renderer, callback + events `assets-created/moved/deleted/changed` | tồn tại ở renderer | main tool dùng `Editor.assetdb` main tương ứng |

#### Main API (`asset-db-main` + `asset-management`) — dùng trong `main.ts`

| API | Docs chính thống | Verified 2.4.15 | Tool 2x dùng |
|---|---|---|---|
| `Editor.assetdb.queryInfoByUuid` (forum gọi) | docs chính thống gọi `assetInfoByUuid` (main) | **RENDERER-only.** Main dung `assetInfoByUuid()` sync | `assetQuery info` goi `assetInfoByUuid` |
| `Editor.assetdb.queryMetaInfoByUuid` | docs ghi `loadMetaByUuid` (main) | **RENDERER-only.** Main dung `loadMetaByUuid()` sync (live circular) | `assetQuery meta` doc `.meta` file |
| `Editor.assetdb.move(src,dest,cb)` | main `move(srcUrl, destUrl, cb)` | OK | `assetMove` |
| `Editor.assetdb.createOrSave(path, data)` | `createOrSave` ghi ở `asset-db-renderer` là renderer; main có `create`/`saveExists` riêng | OK (callback) | `assetWriteContent` dung `fs` + `refresh` |
| `Editor.assetdb.delete(urls, cb)` | main `delete(urls, cb)` | OK, reserved word | `assetDelete` |
| `Editor.assetdb.create(url, data, cb)` | main `create(url, data, cb)` — `results[].uuid/parentUuid/url/path/type` | OK | `assetCreateFolder` dung `mkdirSync` + `refresh` |
| `Editor.assetdb.saveExists(url, data, cb)` | main `saveExists` | OK | — (gộp vào `assetWriteContent` fs path) |
| `Editor.assetdb.saveMeta(uuid, jsonString, cb)` | main `saveMeta(uuid, JSON.stringify(meta,null,2), cb)` → `asset-db:asset-changed` | OK | `assetSaveMeta(uuid, metaJson|meta)` — `JSON.stringify` validated |
| `Editor.assetdb.import(rawfiles, destUrl, cb)` | main `import(['/User/foo.js'], 'db://assets/foobar', cb)` → `results[].uuid/parentUuid` | OK | `assetImport(rawfiles[], destUrl)` → `results[]` |
| `Editor.assetdb.refresh(url, cb)` | main `refresh` → `result.command ∈ {delete,change,create,uuid-change}` | OK, `cb` optional | `assetRefresh(url)` → `{url, results[]}` |
| `Editor.assetdb.queryAssets(pattern, types, cb)` | main `queryAssets(pattern, assetTypes, cb)` — `types` accept `string|string[]` per docs | OK, `types=null` = all | `assetQuery search` — `assetTypes: string|string[]`, `normalizeTypes()` |
| `Editor.assetdb.deepQuery(cb)` | main `deepQuery` docs ghi `result.name/uuid/type/children` hierarchical | OK nhung **tra flat** + `parentUuid` | `assetQuery tree` build cay |
| `Editor.assetdb.queryMetas(pattern, type, cb)` | main `queryMetas` → meta instances | chưa verify | `assetQuery metas` — `safeSerialize` + `__uuid/__url` hint (code circular-safe, chưa smoke) |
| `Editor.assetdb.uuidToUrl(uuid)` | main conversion sync | OK | `assetResolve url_from_uuid` |
| `Editor.assetdb.urlToUuid(url)` | main sync | OK | `assetResolve uuid_from_url` |
| `Editor.assetdb.fspathToUrl(fspath)` | main sync | OK | `assetResolve fspath` |
| `Editor.assetdb.urlToFspath(url)` | main sync | OK | `assetResolve fspath`, `assetReadContent` |
| `Editor.assetdb.getRelativePath(fspath)` | main `getRelativePath` | chưa verify | `assetResolve relative_path` — `getRelativePath(fspath)` |
| `Editor.assetdb.getAssetBackupPath(filePath)` | main `getAssetBackupPath` | chưa verify | `assetResolve backup_path` — `getAssetBackupPath(fspath)` |
| `Editor.assetdb.exchangeUuid(urlA, urlB, cb)` | main `exchangeUuid` | chưa verify | `assetExchangeUuid(urlA, urlB)` |
| `Editor.assetdb.exists(url)` | main sync | OK | `assetResolve exists` |
| `Editor.assetdb.existsByUuid(uuid)` | main sync | OK | `assetResolve exists` |
| `Editor.assetdb.existsByPath(fspath)` | main `existsByPath` | chưa verify | `assetResolve exists_by_path` — `existsByPath(fspath)` |
| `Editor.assetdb.isSubAsset(url)` / `ByUuid` / `ByPath` | main sync boolean | chưa verify | `assetResolve is_sub_asset` — `isSubAsset/ByUuid/ByPath` |
| `Editor.assetdb.containsSubAssets(url)` family | main sync boolean | chưa verify | `assetResolve contains_sub_assets` — `containsSubAssets*` |
| `Editor.assetdb.assetInfo(url)` | main sync | OK | `assetQuery info` |
| `Editor.assetdb.assetInfoByUuid(uuid)` | main sync | OK | `assetQuery info` |
| `Editor.assetdb.assetInfoByPath(fspath)` | main `assetInfoByPath` | chưa verify | — |
| `Editor.assetdb.subAssetInfos(url)` | main sync | OK | `assetQuery sub_assets` |
| `Editor.assetdb.subAssetInfosByUuid(uuid)` | main sync | OK | `assetQuery sub_assets` |
| `Editor.assetdb.subAssetInfosByPath(fspath)` | main `subAssetInfosByPath` | chưa verify | — |
| `Editor.assetdb.loadMeta(url)` family | main sync live object | circular `_uuid2meta` | — |
| `Editor.assetdb.mount(path, mountPath, opts, cb)` / `unmount` / `attachMountPath` / `unattachMountPath` | main mount | chưa verify | — (mount đã backlog) |
| `Editor.assetdb.register(extname, folder, metaCtor)` | main `register` | chưa verify | — |
| `Editor.assetdb.isMount(url)` family / `mountInfo` | main | chưa verify | `assetResolve mount_info` — `mountInfo/ByUuid/ByPath` |
| `Editor.assetdb.init(cb)` | main `init` — scan mounts | chưa verify | — |
| `Editor.assetdb.clearImports(url, cb)` | main `clearImports` | chưa verify | — |
| `Editor.remote.assetdb.*` | `Editor.remote` same as main `Editor.assetdb` | **RENDERER-only**, khong dung o main | — |
| `Editor.remote.UuidUtils.*` | `UuidUtils.compress/decompress` | **RENDERER-only** | — |
| `Editor.assettype2name` | class -> type | OK, 31 type | `assetQuery types`, `editorListTypes asset_types` |
| `Editor.Utils.UuidUtils.uuid()` | generate uuid | OK | — (khong can, uuid do engine cap) |
| `Editor.Ipc.sendToPanel('scene', 'scene:new-scene')` | `asset-management` docs | OK | `sceneNew` (`scene:new-scene`, fire-and-forget) |
| `Editor.Ipc.sendToPanel('scene', 'scene:stash-and-save')` | `asset-management` save | OK | `editorOperate save_scene` |
| `_Scene.loadSceneByUuid(uuid, cb)` | `asset-management` load | OK | `sceneOpen` via `sceneScript('open-scene')` |
| `scene:set-prefab-sync` (reply #41) | forum #41 `Editor.Ipc.sendToPanel("scene","scene:set-prefab-sync", prefabUuid)` | chưa verify | `prefabSync(prefabUuid)` — `scene:set-prefab-sync` |

| API | Forum mo ta | Verified 2.4.15 | Tool 2x dung |
|---|---|---|---|
| `Editor.assetdb.queryInfoByUuid` | query file info | **RENDERER-only.** Main dung `assetInfoByUuid()` sync | `assetQuery info` goi `assetInfoByUuid` |
| `Editor.assetdb.queryMetaInfoByUuid` | query meta | **RENDERER-only.** Main dung `loadMetaByUuid()` sync (nhung tra live object circular) | `assetQuery meta` **khong goi** `loadMeta*` — doc file `.meta` truc tiep |
| `Editor.assetdb.move(src,dest,cb)` | move/rename | OK, main co | `assetMove` |
| `Editor.assetdb.createOrSave(path, data)` | create/write | OK (callback) | `assetWriteContent` dung `fs.writeFileSync` + `refresh` thay vi `createOrSave` — re hon, tranh reimport race |
| `Editor.assetdb.delete(urls, cb)` | delete | OK, reserved word -> `(Editor.assetdb as any)['delete']` | `assetDelete` |
| `Editor.assetdb.create(url, data, cb)` | create | OK | `assetCreateFolder` dung `mkdirSync` + `refresh` |
| `Editor.assetdb.refresh(url, cb)` | refresh | OK, `cb` optional | `assetCreateFolder` / `assetWriteContent` / `assetDelete` |
| `Editor.assetdb.queryAssets(pattern, types, cb)` | search | OK, `types=null` = moi type | `assetQuery search` |
| `Editor.assetdb.deepQuery(cb)` | tree | OK nhung **tra flat** + `parentUuid`, khong co `children` nhu docs | `assetQuery tree` build cay tu `parentUuid` |
| `Editor.assetdb.uuidToUrl(uuid)` | url <- uuid | OK, sync | `assetResolve url_from_uuid`, `assetQuery used_by` |
| `Editor.assetdb.urlToUuid(url)` | uuid <- url | OK, sync | `assetResolve uuid_from_url` |
| `Editor.assetdb.fspathToUrl(fspath)` | url <- fspath | OK, sync | `assetResolve fspath` (qua `fspathToUrl`/`urlToFspath` tuy chieu) |
| `Editor.assetdb.urlToFspath(url)` | fspath <- url | OK, sync | `assetResolve fspath`, `assetReadContent`, `assetQuery meta` |
| `Editor.assetdb.exists(url)` | exists | OK, sync | `assetResolve exists` + `assetGetAvailableUrl` |
| `Editor.assetdb.existsByUuid(uuid)` | exists by uuid | OK, sync | `assetResolve exists` |
| `Editor.assetdb.assetInfo(url)` | info | OK, sync | `assetQuery info` |
| `Editor.assetdb.assetInfoByUuid(uuid)` | info by uuid | OK, sync | `assetQuery info` |
| `Editor.assetdb.subAssetInfos(url)` | sub assets | OK, sync | `assetQuery sub_assets` |
| `Editor.assetdb.subAssetInfosByUuid(uuid)` | sub by uuid | OK, sync | `assetQuery sub_assets` |
| `Editor.remote.assetdb.*` | remote convert | **RENDERER-only**, khong dung o main | — |
| `Editor.remote.UuidUtils.*` | uuid compress | **RENDERER-only** | — |
| `Editor.assettype2name` | class -> type | OK, 31 type | `assetQuery types`, `editorListTypes asset_types` |
| `Editor.Utils.UuidUtils.uuid()` | generate uuid | OK | — (khong can, uuid do engine cap) |

**Bay da verify:**
- **Bay 3:** `deepQuery` flat, docs sai `children`. Fix `buildTree` group theo `parentUuid`.
- **Bay 4:** `loadMeta*` circular `_uuid2meta`, `JSON.stringify` no. Fix doc `.meta` file.

### 1.2 Su kien asset-db (listenable)

Forum: `asset-db:assets-created`, `assets-moved`, `asset-changed`, `assets-deleted`, `state-changed`, `asset-uuid-changed`. Chua dung truc tiep trong tool (tool goi sync/refresh chu dong). Co the dung cho watcher tuong lai.

---

## 2. Selection — `Editor.Selection` (main process)

Nguồn: `https://docs.cocos.com/creator/2.4/manual/zh/extension/api/editor-framework/share/selection.html` (full 18 methods) + forum snippet. Gap trước đó đã đúng — bổ sung 8 method chưa liệt trong bảng cũ.

| API | Docs chính thống | Verified | Tool |
|---|---|---|---|
| `Editor.Selection.select(type, id[, unselectOthers, confirm])` | `select(type, id, unselectOthers?, confirm?)` | OK, nhan **array** | `editorSelect select` — `confirm` exposed (`false`=do not confirm) |
| `Editor.Selection.unselect(type, id[, confirm])` | `unselect(type, id, confirm?)` | OK | `editorSelect unselect` — `confirm` exposed |
| `Editor.Selection.hover(type, id)` | `hover(type, id)` — `id=null` = hover out | chưa verify | `editorSelect hover` — `ids` 1 id (omit=out) |
| `Editor.Selection.setContext(type, id)` | `setContext(type, id)` | chưa verify | `editorSelect set_context` — `ids` 1 id |
| `Editor.Selection.patch(type, srcID, destID)` | `patch(type, srcID, destID)` | chưa verify | `editorSelect patch` — `ids`=`srcId,destId` (drag reorder) |
| `Editor.Selection.clear(type)` | `clear(type: string)` | OK | `editorSelect clear` |
| `Editor.Selection.hovering(type)` | `hovering(type)` | OK | `editorSelect query` (`hovering`) |
| `Editor.Selection.contexts(type)` | `contexts(type)` | chưa verify | `editorSelect query` — `contexts` (tryGet) |
| `Editor.Selection.curActivate(type)` | `curActivate(type)` | OK | `editorSelect query` (`activate`) |
| `Editor.Selection.curGlobalActivate(type)` | `curGlobalActivate(type)` → `{type, id}` | OK | `editorSelect query` — `globalActive` (tryGet) |
| `Editor.Selection.curSelection(type)` | `curSelection(type)` → `string[]` | OK | `editorSelect query` (`selected`) |
| `Editor.Selection.filter(items, mode, func)` | `filter(items: string[], mode: 'top-level'|'deep'|'name', func)` | chưa verify | `editorSelect filter` — `ids` items + `filterMode` |
| `Editor.Selection.confirm()` | `confirm()` — may trigger `deactivated/activated` | chưa verify | `editorSelect confirm` |
| `Editor.Selection.cancel()` | `cancel()` — may trigger `selected/unselected` | chưa verify | `editorSelect cancel` |
| `Editor.Selection.confirmed(type)` | `confirmed(type) -> boolean` | chưa verify | `editorSelect query` — `confirmed` (tryGet) |
| `Editor.Selection.register(type)` | `register(type: string)` | chưa verify | — (register/reset/local — backlog low-ROI) |
| `Editor.Selection.reset()` | `reset()` | chưa verify | — |
| `Editor.Selection.local()` | `local() -> ConfirmableSelectionHelper` | chưa verify | — |

`type` = `'node'` | `'asset'`. Full 18 methods: 15 landed in `editorSelect` (query/select/unselect/clear/hover/set_context/patch/filter/confirm/cancel + query fields selected/activate/hovering/globalActive/contexts/confirmed); `register/reset/local` backlog (low-ROI). Methods marked "chưa verify" need Creator smoke — they throw cleanly if absent.

---

## 3. Asset Panel — IPC Events (renderer)

Forum liet ke ~15 su kien: `assets:copy/paste/hint/search/clearSearch/new-asset/find-usages/rename/delete/start-refresh/end-refresh/popup-context-menu/open-text-file`, `selection:selected/unselected/activated`.

**Trang thai 2x:** chua dung. Tool asset di thang `Editor.assetdb` (main), khong qua panel `assets`. Chi can khi lam UI asset panel sau nay.

Su kien `assets:find-usages` tuong ung `assetQuery used_by` nhung 2.4 khong co message `scene:query-node-by-asset` — tool walk scene-script thay the.

---

## 4. Scene Editor — `scene:*` IPC (scene panel, main -> scene)

### 4.1 API forum liet ke

| API | Forum | Verified 2.4.15 | Tool |
|---|---|---|---|
| `scene:create-node-by-classid` | create node by class | **Probe 4: timeout (registered, no reply)** | `nodeCreate` dung `cc.Node` — **không port** |
| `scene:add-component` | add component | **Probe 4: timeout (registered, no reply)** | `nodeComponentManage add` trong scene-script — **không port** |
| `scene:remove-component` | remove component | **Probe 4: timeout (registered, no reply)** | `nodeComponentManage remove` — **không port** |
| `scene:copy-nodes` / `paste-nodes` | copy/paste | **Probe 4: timeout (registered, no reply)** | `nodeClipboard` thu `scene:copy/cut/paste` + fallback — **không port** |
| `scene:create-nodes-by-uuids` | prefab insert | **Probe 4: timeout (registered, no reply)** | chua dung truc tiep — **không port** |
| `scene:set-property` | set prop | **Probe 4: timeout (registered, no reply)** | `nodeSetProperty*` trong scene-script — **không port** |
| `scene:query-hierarchy` | hierarchy | **OK** — `(err, sceneID, hierarchy)` | `nodeQuery tree` |
| `scene:query-node` | dump | **OK** — tra **string** JSON | `nodeQuery dump` |
| `scene:query-node-info` | info | **OK** | `nodeQuery info` |
| `scene:query-node-functions` | functions | **OK** | `listComponentMethods` |
| `scene:query-nodes-by-comp-name` | by component | **OK** — mang uuid tran | `nodeQuery by_component` |
| `scene:query-animation-node` | anim root | **KHONG TON TAI** | `animationQuery` dung scene-script thay the |

### 4.2 Scene IPC Events — 170+ ten forum liet ke

Forum dump ~170 ten `scene:*` (is-ready, new-scene, saved, undo, redo, query-hierarchy, create-nodes-by-uuids, create-prefab, move-nodes, delete-nodes, ready, reloading...).

**Verified ton tai (phase 5):** 6 message — `scene:query-hierarchy`, `scene:query-node`, `scene:query-node-info`, `scene:query-node-functions`, `scene:query-nodes-by-comp-name` (+ `scene:stash-and-save` qua `editorOperate save_scene`). Con lai chua probe — `.ccc` ma hoa khong enumerate duoc, chi biet bang thu runtime.

**Probe 3 ket luan (C.1):** 11 message thu them deu `not found` — `scene:query-scene-mode`, `query-is-ready`, `query-layer-builtin`, `query-sorting-layer-builtin`, `query-enum-list-with-path`, `query-script-name/cid`, `query-is2D`, `query-is-grid-visible`, `query-is-icon-gizmo-3d`, `query-icon-gizmo-size`, `set-icon-gizmo-3d/size`. → `editorIntrospect` + `editorViewport` (3.x) **dong so, khong port**.

**Probe 4 ket luan (Phase B, 2026-08-20):** 14 `scene:*` mutation/write (create-node-by-classid, add/remove-component, copy/paste/create-nodes-by-uuids/create-node-by-prefab, set/new/reset-property, move/delete/duplicate-nodes, create-prefab) đều **`timeout` (registered nhưng không reply callback)**, phân biệt với `closed` (`ipc failed to send, message not found`). → **KHÔNG port B+** — giữ write train `scene://utils/scene.*` + `scene://set-property-by-path` + direct assign. Xem `cocos-2x-api-notes.md` Probe 4.

---

## 5. Scene-script — `Editor.Scene.callSceneScript` + `Editor.require('scene://...')`

### 5.1 Signature

`Editor.Scene.callSceneScript(pkg, msg, ...args, cb)` — handler `(event, ...args)`, reply `event.reply(null, data)`. Verify phase 3.

### 5.2 `scene://` modules (engine source + probe3)

| Module | Forum goi y | Probe3 exports (so luong) | Dung cho |
|---|---|---|---|
| `scene://utils/node` | transform helpers | 27 keys — `getWorldBounds`, `setWorldPosition`, `getNodePath`, `createNodeFromAsset`... | `nodeMove` fallback, probe |
| `scene://utils/scene` | scene ops | 24 keys — `createNodes`, `setProperty`, `copyComponent`, `deleteNodes`, `createProperty`... | `sceneCreateNodeHL`, `sceneSetPropertyHL` |
| `scene://set-property-by-path` | set prop | `setPropertyByPath`, `setAsset`, `getPropertyByPath`, `setNodePropertyByPath` — sig `(nodeOrUuid?, {path,value,type,isSubProp})` object form | `nodeSetPropertyUndo`, `batchSetProperties undo:true`, `nodeReset` |
| `scene://utils/prefab` | prefab | chua probe ky | chua dung |
| `scene://utils/animation` | animation | chua probe ky | `animationQuery` dung `probe-animation` truc tiep |
| `scene://undo/index` | undo | giong `_Scene.Undo` (recordObject/Node/Create/Delete/Move/AddComp...) | undo-aware write |

**Luu y:** `scene-script.ts` chay trong **scene process** — khong import gi, standalone CommonJS. So o vi tri cuoi bi IPC nuot lam timeout → boc trong object.

---

## 6. Undo

| API | Forum | Probe3 | Tool |
|---|---|---|---|
| `Editor.Undo` (main) | undo/commit | 15 keys — `undo/redo/add/commit/cancel/collapseTo/save/clear/reset/dirty` | `editorUndo` thu `scene:undo/redo` + `undo/redo` |
| `_Scene.Undo` / `scene://undo/index` (scene) | recorder | 18 keys — `recordObject/Node/Create/Delete/Move/Add/RemoveComponent/commit/cancel/undo/redo` | `scene://set-property-by-path` tu record ben trong; `Editor.Undo.commit` tu main la commit surface |

Write train dung duong: `scene://set-property-by-path` (tu record) + `Editor.Undo.commit` neu can.

---

## 7. Editor & Project

| API | Forum | Verified | Tool |
|---|---|---|---|
| `Editor.Project.path` | project path | **OK** (`Editor.projectPath` = 0 hit, dung `Editor.Project.path`) | `editorEnvInfo`, `projectGetConfig`, `editorGetLogs` |
| `Editor.versions` | versions | OK — `{CocosCreator, editor-framework, asset-db, cocos2d}`, node 14.16.0/electron 13.1.4 | `editorEnvInfo` |
| `Editor.Profile.load(url, default)` | profile | OK, khong can `register` | `config-manager` |
| `profile.set/get/save` | profile write | **PHAI dung `.set()`**, gan thang property khong persist (bay Profile) | `config-manager` |
| `Editor.PreviewServer` | preview url | candidates `preview:query-preview-url` / `scene:query-preview-url` | `previewGetUrl` |
| `Editor.Ipc.sendToPanel` | IPC to panel | OK | `sceneIpc`, `panelIpc` |
| `Editor.Ipc.sendToMain` | IPC to main | OK | `programGetInfo`, `assetGetPreview` |
| `Editor.require('scene://...')` | scene module | OK trong scene process | scene-script probes |
| `cc.engine.getInstanceById(uuid)` | resolve node | **OK**, `hierarchyUuid === _id`, tra cung instance | moi mutation resolve node |
| `cc.director.getScene()` | scene root | OK | `sceneSnapshot`, `sceneInfo`, walk |
| `cc.find(path)` | find by path | OK | `node-at-path`, `component-props`, `find-by-component` |

**Bay 1:** `cc.view.getDesignResolutionSize()` = viewport editor, khong phai design resolution. That o `cc.Canvas.designResolution`.
**Bay 2:** scene root co 2 node editor `objFlags 1096` (`HideInHierarchy`), phai filter o root.

---

## 8. Debug / Tracing (forum goi y)

- Trace send: breakpoint `ipcRenderer.send` o renderer ipc.
- Trace receive: breakpoint `EventEmitter.prototype.emit`.
- Log moi panel message: wrap `Editor.Ipc.sendToPanel` log args truoc khi goi goc.

Tuong ung tool debug: `GET /debug-logs`, `UTCP_DEBUG=1`, `source/utcp/utils/ipc-promise.ts` wrappers. `~/.utcp-debug/*.jsonl` (main) + `scene-console-*.jsonl` (scene `startCatchAll`).

---

## 9. Khong port / chua port

| Nhom | Tool 3.x | Ly do |
|---|---|---|
| Build | `buildTrigger` etc. 5 tool | `Editor.Builder` 2.4 chi co `on/once/removeListener` — khong co trigger |
| Console read | `editorGetLogs` (cu) | `console:query-logs` khong ton tai. Ban moi doc `temp/logs/project.log` |
| Viewport gizmo | `editorViewport` | 6 message probe fail |
| Introspect | `editorIntrospect` | 6 message probe fail |
| Asset dep graph | `assetFindReferences` | khong co API reference/dependency |
| Animation edit | `animationEdit operate` | khong co scene message, edit `.anim` qua `assetWriteContent` |

---

## 10. Nguon doi chieu

- **Forum raw dump (offline):** `docs/forum-92605-cocos-2x-api.md` — toan bo 92605 trich offline (9 section, 170+ scene:* names, snippet, panel DOM tips), link goc ke tren
- **Forum goc:** https://forum.cocos.org/t/topic/92605/5 (cap nhat gan nhat trong bai)
- **Verified runtime:** `docs/cocos-2x-api-notes.md` (probe 1/2/3, 6 bay, phase 5/6/7, C.1)
- **Engine source:** `C:\ProgramData\cocos\editors\Creator\2.4.15\resources\engine\` (982 .js plain)
- **App.asar:** `G:\_ws\cc_2_4_15\app_asar_cc_2_4_15\` (893 `.ccc` ma hoa — khong doc duoc signature, chi biet ten module)
- **Surface that:** `code-mode-references-2x.d.ts` + `source/utcp/tools-2x/*.ts` (53 tool, `npm run check` + 22 self-checks + `tsc --noEmit`)
