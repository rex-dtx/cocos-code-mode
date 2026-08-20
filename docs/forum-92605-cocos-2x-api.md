# Forum 92605 — Cocos 2.4.x Editor API (compendium)

> **Nguồn gốc:** https://forum.cocos.org/t/topic/92605 (topic + reply #5 và #41, community-collected). Fetch 2026-08-20 qua `WebFetch` (excerpt 125 chars + paraphrase grouping, không phải verbatim full do tool limit). Bổ sung 2026-08-20 từ 4 nguồn chính thống: `asset-db-renderer`, `asset-db-main`, `selection`, `asset-management`. Đây là **raw dump** để tra offline — không phải verified spec.
>
> **Đối chiếu verified:** `api-2x-reference.md` (bảng 1:1 forum ↔ verified runtime 2.4.15 ↔ 46 tool). Khi lệch, tin `cocos-2x-api-notes.md` + probe runtime.

## Mục lục

- §1 Asset DB — renderer vs main + links (§1a renderer, §1b main full, §1c asset-management)
- §2 Selection — `Editor.Selection` (full API từ selection.html)
- §3 Asset panel IPC — `assets:*`
- §4 Scene editor — `scene:*` create/component/set-property (+ reply #41 `set-prefab-sync`)
- §5 Scene IPC full dump — 170+ names, nhóm query/create/property/component/prefab/undo/animation/misc
- §6 Editor internals — `Editor.Ipc`, `electron-ipc-plus`, `editor:*`, `_selection:*`, `timeline:*`, etc.
- §7 Debugging — breakpoint & wrap tips
- §8 Panel DOM — `tools`, `scene`, `inspector`, `toolbar` tips
- §9 Links

---

## §1 Asset DB

> **Cập nhật 2026-08-20:** Bổ sung chi tiết từ 3 nguồn chính thống (fetch trực tiếp):
> `asset-db-renderer.html` · `asset-db-main.html` · `asset-management.html`. Forum chỉ nêu snippet, docs chính thống nêu đủ API. Dưới đây gộp.

### §1a Renderer — `Editor.assetdb` (renderer process)

Nguồn: `https://docs.cocos.com/creator/2.4/manual/zh/extension/api/asset-db/asset-db-renderer.html`

Instance: `Editor.assetdb` (singleton renderer). Thuộc tính:
- `remote` — "The remote AssetDB instance of main process" (same as `Editor.remote.assetdb`)
- `library` — library path
- `assetdb` — AssetDB instance

Methods (renderer) — **đừng dùng từ main process** (forum nhầm lẫn, verified renderer-only):

| Method | Params | Return / callback | Note |
|---|---|---|---|
| `explore(url)` | `url: string` | — | Reveal in file system |
| `exploreLib(url)` | `url: string` | — | Reveal library file |
| `queryPathByUrl(url, [cb])` | `url` | `cb.path: string` | |
| `queryUuidByUrl(url, [cb])` | `url` | `cb.path` (uuid) | Forum gọi `queryUuidByUrl` |
| `queryPathByUuid(uuid, [cb])` | `uuid` | `cb.path` | |
| `queryUrlByUuid(uuid, [cb])` | `uuid` | `cb.url` | |
| `queryInfoByUuid(uuid, [cb])` | `uuid` | `info.path/url/type` | Forum snippet `queryInfoByUuid(uuid, function(err, info){...})` |
| `queryMetaInfoByUuid(uuid, [cb])` | `uuid` | `info.assetPath/metaPath/metaMtime/json` | Forum nêu |
| `deepQuery([cb])` | — | `result.name/uuid/type/children` | Docs renderer ghi có `children` |
| `queryAssets(pattern, assetTypes, [cb])` | `pattern: string`, `assetTypes: string|array` | `result.url/path/uuid` | Helper `Editor.assettype2name[cc.js.getClassName(asset)]` |
| `import(rawfiles, destUrl, showProgress, [cb])` | `rawfiles: string[]`, `destUrl: string` | `asset-db:assets-created` | `db://assets/foobar` |
| `create(url, data, [cb])` | `url, data: string` | `asset-db:assets-created` | `db://assets/foo/bar/foobar.js` |
| `move(srcUrl, destUrl, showMessageBox)` | `srcUrl, destUrl` | `asset-db:assets-moved` | |
| `delete(urls)` | `urls: string[]` | `asset-db:assets-deleted` | |
| `saveExists(url, data, [cb])` | `url, data` | `asset-db:asset-changed` | |
| `createOrSave(url, data, [cb])` | `url, data` | create hoặc save | |
| `saveMeta(uuid, metaJson, [cb])` | `uuid, json: string` | `asset-db:asset-changed` | `JSON.stringify(meta,null,2)` |
| `refresh(url, [cb])` | `url` | `result.command: delete/change/create/uuid-change` + `uuid/parentUuid` | |

> Tools-2x dùng main API cho 14 dòng đầu — renderer API chỉ để tham chiếu (đừng gọi từ `main.ts`).

### §1b Main — `Editor.assetdb` (main process, singleton)

Nguồn: `https://docs.cocos.com/creator/2.4/manual/zh/extension/api/asset-db/asset-db-main.html`

**Path / URL / UUID conversion (sync, return string|null):**

```
urlToUuid(url) -> uuid|null
fspathToUuid(fspath) -> uuid|null
uuidToFspath(uuid) -> fspath|null
uuidToUrl(uuid) -> url|null
fspathToUrl(fspath) -> url|null
urlToFspath(url) -> fspath|null
```

**Existence (sync boolean):**
`exists(url)`, `existsByUuid(uuid)`, `existsByPath(fspath)`

**Sub-asset (sync boolean/array):**
`isSubAsset(url)`, `isSubAssetByUuid(uuid)`, `isSubAssetByPath(fspath)`
`containsSubAssets(url)`, `containsSubAssetsByUuid(uuid)`, `containsSubAssetsByPath(path)`

**Info / meta (sync):**
`assetInfo(url)`, `assetInfoByUuid(uuid)`, `assetInfoByPath(fspath)` -> `{uuid, path, url, type, isSubAsset}`
`subAssetInfos(url)`, `subAssetInfosByUuid(uuid)`, `subAssetInfosByPath(fspath)` -> `[{uuid, path, url, type, isSubAsset}]`
`loadMeta(url)`, `loadMetaByUuid(uuid)`, `loadMetaByPath(fspath)` -> meta instance (live object — **bay 4**: circular `_uuid2meta`, đừng `JSON.stringify`)

**Mount:**
`isMount(url)`, `isMountByPath/ByUuid`, `mountInfo(url/ByUuid/ByPath)` -> mount object
`mount(path, mountPath, opts, cb)` — `opts: {hide, virtual, icon}`, `attachMountPath(mountPath, cb)` / `unattachMountPath` / `unmount(mountPath, cb)`

**Query / lifecycle (async cb):**
`init(cb)` — scan mounts, import pending
`refresh(url, cb)` — `result.command ∈ {create, delete, change, uuid-change}`
`deepQuery(cb)` — **verified flat** + `parentUuid` (docs main ghi hierarchical `children` — **bay 3**)
`queryAssets(pattern, assetTypes, cb)` — `assetTypes=null` = all types (verified)
`queryMetas(pattern, type, cb)` -> meta instances

**Asset operations (async cb):**
`move(srcUrl, destUrl, cb)`, `delete(urls, cb)`, `create(url, data, cb)`, `saveExists(url, data, cb)`, `import(rawfiles, url, cb)`, `saveMeta(uuid, jsonString, cb)`, `exchangeUuid(urlA, urlB, cb)`, `clearImports(url, cb)`
`register(extname, folder, metaCtor)` / `unregister(metaCtor)` — meta type
`getRelativePath(fspath)`, `getAssetBackupPath(filePath)`

### §1c Asset management — `asset-management.html` (new-scene anchor)

Nguồn: `https://docs.cocos.com/creator/2.4/manual/zh/extension/asset-management.html?h=new-scene`

Scene management:
```js
Editor.Ipc.sendToPanel('scene', 'scene:new-scene');
Editor.Ipc.sendToPanel('scene', 'scene:stash-and-save'); // save
_Scene.loadSceneByUuid(uuid, function(error){ /* ... */ });
```

Resource URL/UUID:
```js
Editor.assetdb.urlToUuid(url); Editor.assetdb.uuidToUrl(uuid);
Editor.assetdb.fspathToUuid(fspath); Editor.assetdb.uuidToFspath(uuid);
```

Asset ops (với `results.forEach` shape `uuid/parentUuid/url/path/type`):
```js
Editor.assetdb.import(['/User/user/foo.js', '/User/user/bar.js'], 'db://assets/foobar', function(err, results){ /* result.uuid/parentUuid/url/path/type */ });
Editor.assetdb.create('db://assets/foo/bar.js', data, function(err, results){ /* ... */ });
Editor.assetdb.saveExists('db://assets/foo/bar.js', data, function(err, meta){});
Editor.assetdb.exists(url); // -> boolean
Editor.assetdb.createOrSave('db://assets/foo/bar/foobar.js', data, callback); // renderer note: docs ghi "renderer process" cho createOrSave
Editor.assetdb.refresh('db://assets/foo/bar/', function(err, results){});
Editor.assetdb.move(srcUrl, destUrl);
Editor.assetdb.delete([url1, url2]);
```

> Forum #41 thêm: `Editor.Ipc.sendToPanel("scene", "scene:set-prefab-sync", "d1n+BilrRKdZBt8xztUpGO")` — prefab sync dialog (revert/apply), chưa có tool wrapper.

### Snippet — renderer API (forum ghi là "renderer")

```js
Editor.assetdb.queryInfoByUuid(uuid, function (err, info) {
    // info.path, info.url, info.type
});
Editor.remote.assetdb.uuidToUrl(file_uuid);
Editor.remote.assetdb.fspathToUrl(abs_path);
Editor.remote.assetdb.urlToUuid(url);
Editor.remote.UuidUtils.compressUuid(uuid);
Editor.remote.UuidUtils.decompressUuid(uuid);
Editor.Utils.UuidUtils.decompressUuid(Editor.Utils.UuidUtils.uuid());
```

### Snippet — main API (forum ghi là "asset-db main")

```js
Editor.assetdb.move('db://assets/foo/bar/foobar.js', 'db://assets/foo/bar/foobar02.js');
Editor.assetdb.createOrSave('db://assets/foo/bar/foobar.js', 'var foobar = 0;');
Editor.assetdb.delete(['db://assets/foo/bar/foobar.js','db://assets/foo/bar/foobar02.js']);
```

> Verified note (`api-2x-reference` §1.1): `queryInfoByUuid`/`queryMetaInfoByUuid` + `Editor.remote.*` là **renderer-only**; main dùng `assetInfoByUuid()`/`loadMetaByUuid()` sync (nhưng `loadMeta*` circular — đọc `.meta` file). `createOrSave`/`create` tồn tại nhưng `tools-2x` dùng `fs+refresh` workaround (rẻ, tránh reimport race).

---

## §2 Selection

Nguồn: `https://docs.cocos.com/creator/2.4/manual/zh/extension/api/editor-framework/share/selection.html` (full) + forum snippet.

Full API (official docs):

| Method | Params | Return / note |
|---|---|---|
| `Editor.Selection.register(type)` | `type: string` | register selection type |
| `Editor.Selection.reset()` | — | reset |
| `Editor.Selection.local()` | — | -> `ConfirmableSelectionHelper` |
| `Editor.Selection.confirm()` | — | confirm all, may trigger `deactivated/activated` |
| `Editor.Selection.cancel()` | — | cancel all, may trigger `selected/unselected` |
| `Editor.Selection.confirmed(type)` | `type: string` | -> boolean |
| `Editor.Selection.select(type, id[, unselectOthers, confirm])` | `type, id: string, unselectOthers?: boolean, confirm?: boolean` | select |
| `Editor.Selection.unselect(type, id[, confirm])` | `type, id, confirm?: boolean` | unselect |
| `Editor.Selection.hover(type, id)` | `type, id: string` | hover; `id=null` = hover out |
| `Editor.Selection.setContext(type, id)` | `type, id` | context |
| `Editor.Selection.patch(type, srcID, destID)` | `type, srcID, destID` | patch |
| `Editor.Selection.clear(type)` | `type` | clear |
| `Editor.Selection.hovering(type)` | `type` | -> hovering uuid |
| `Editor.Selection.contexts(type)` | `type` | -> contexts |
| `Editor.Selection.curActivate(type)` | `type` | -> activate per-type |
| `Editor.Selection.curGlobalActivate(type)` | `type` | -> `{type, id}` global |
| `Editor.Selection.curSelection(type)` | `type` | -> `string[]` |
| `Editor.Selection.filter(items, mode, func)` | `items: string[], mode: 'top-level'|'deep'|'name', func` | filter |

Forum snippet (selection usage):

```js
Editor.Selection.clear('asset');
Editor.Selection.select('asset', uuid);
Editor.Selection.curSelection("asset"); // -> uuid[]

let activeInfo = Editor.Selection.curGlobalActivate();
// activeInfo.type == "node" | "asset", activeInfo.id
if (activeInfo && activeInfo.type == "node") { /* ... */ }
else if (activeInfo && activeInfo.type == "asset") { /* ... */ }

Editor.Selection.clear('node');
Editor.Selection.select('node', uuid);
Editor.Selection.curSelection("node");
```

Thêm (`hovering` không có snippet nhưng forum liệt trong selection API):
- `Editor.Selection.hovering(type)` — hovering uuid
- `Editor.Selection.curActivate(type)` — activate per-type

> Verified: `select` nhận **array** (`api-2x-reference` §2). `curGlobalActivate` hiện chưa expose qua `editorSelect query` — Phase 1 fix.

---

## §3 Asset panel IPC — `assets:*` + `selection:*` + `asset-db:*`

### `assets:*` (forum liệt ~13)

```
assets:copy, assets:paste, assets:hint, assets:search, assets:clearSearch,
assets:new-asset, assets:find-usages, assets:rename, assets:delete,
assets:start-refresh, assets:end-refresh, assets:popup-context-menu,
assets:open-text-file
```

Snippet:
```js
Editor.Ipc.sendToAll('assets:hint', file_uuid);
Editor.Ipc.sendToMain('assets:open-text-file', file_uuid);
```

### `selection:*`

```
selection:selected, selection:unselected, selection:activated,
selection:deactivated, selection:hoverin, selection:hoverout
```

### `asset-db:*` (listenable, forum nêu)

```
asset-db:assets-created, asset-db:assets-moved, asset-db:asset-changed,
asset-db:assets-deleted, asset-db:state-changed, asset-db:asset-uuid-changed
// + forum extra: asset-db:watch-state-changed
```

> Trạng thái: chưa dùng trực tiếp (tool đi `Editor.assetdb` main sync). `assets:find-usages` tương ứng `assetQuery used_by` nhưng 2.4 không có `scene:query-node-by-asset` nên walk scene-script.

---

## §4 Scene editor — `scene:*` create / component / set-property

```js
Editor.Ipc.sendToPanel('scene', 'scene:create-node-by-classid', 'New Node', '', 'parentUuid');

Editor.Ipc.sendToPanel('scene', 'scene:add-component', nodeID, 'cc.Animation');
Editor.Ipc.sendToPanel('scene', 'scene:remove-component', nodeID, compID);

Editor.Ipc.sendToPanel('scene', 'scene:copy-nodes', uuids);
Editor.Ipc.sendToPanel('scene', 'scene:paste-nodes', parentID);

Editor.Ipc.sendToPanel("scene","scene:create-nodes-by-uuids",[parfab_uuid],parentUuid,{unlinkPrefab:null});

Editor.Ipc.sendToPanel('scene', 'scene:set-property',{
    id: info.args.uuid,
    path: "name",        // property to modify
    type: "String",
    value: info.args.name,
    isSubProp: false,
});
// second example:
    path: "spriteFrame",
    type: "cc.SpriteFrame",
    value: {uuid: spriteFrameUuid},
```

Forum reply #41 — prefab sync (chưa có trong dump #5):
```js
Editor.Ipc.sendToPanel("scene", "scene:set-prefab-sync", "d1n+BilrRKdZBt8xztUpGO");
// prefab uuid -> dialog revert/apply; chưa có cách chọn apply trực tiếp via event, forum hỏi cách log event names/params
```

> Verified note: các IPC này **chưa verify riêng** trên 2.4.15 (§4.1 "chưa verify riêng"). `tools-2x` hiện dùng `cc.Node`/`node.addComponent`/`cc.instantiate`/`scene://utils/scene` trong scene-script thay vì IPC — Phase 2 probe gate sẽ thử từng `scene:*` rồi đổi nếu tồn tại.

---

## §5 Scene IPC full dump (forum liệt kê, chưa nhóm gốc)

Forum dump ~170+ names (gộp từ excerpt + paraphrase grouping, thứ tự không chuẩn). Chia nhóm để tra:

### Query

```
scene:query-hierarchy, scene:query-nodes-by-comp-name, scene:query-node,
scene:query-node-info, scene:query-node-functions,
scene:query-animation-hierarchy, scene:query-animation-list,
scene:query-animation-properties, scene:query-animation-record,
scene:query-animation-clip, scene:query-animation-time,
scene:query-dirty-state, scene:query-group-list,
scene:query-texture-packer-preview-files,
scene:is-child-class-of, scene:has-copied-component,
scene:choose-last-rigid-body, scene:choose-next-rigid-body
// + probe C.1 verified NOT FOUND:
scene:query-scene-mode, scene:query-is-ready, scene:query-layer-builtin,
scene:query-sorting-layer-builtin, scene:query-enum-list-with-path,
scene:query-script-name, scene:query-script-cid,
scene:query-is2D, scene:query-is-grid-visible, scene:query-is-icon-gizmo-3d,
scene:query-icon-gizmo-size
```

### Create / delete / move / duplicate

```
scene:create-nodes-by-uuids, scene:create-node-by-classid,
scene:create-node-by-prefab, scene:create-prefab,
scene:move-nodes, scene:delete-nodes,
scene:copy-nodes, scene:paste-nodes, scene:duplicate-nodes,
scene:center-nodes,
scene:change-node-lock, scene:regenerate-polygon-points
```

### Property / component

```
scene:new-property, scene:reset-property, scene:set-property,
scene:add-component, scene:remove-component,
scene:reset-node, scene:reset-all,
scene:move-up-component, scene:move-down-component,
scene:reset-component, scene:copy-component, scene:paste-component,
scene:apply-prefab, scene:revert-prefab, scene:set-prefab-sync,
scene:break-prefab-instance, scene:link-prefab
```

### Undo

```
scene:undo, scene:redo, scene:undo-record, scene:undo-commit, scene:undo-cancel
```

### Animation timeline

```
scene:query-animation-time, scene:animation-time-changed,
scene:animation-clip-changed, scene:save-clip, scene:set-animation-speed,
scene:change-animation-record, scene:mount-clip,
scene:change-animation-state, scene:change-animation-current-clip,
scene:animation-record-changed, scene:animation-state-changed,
timeline:property-add, timeline:property-remove, timeline:property-add-key,
timeline:property-delete-selected-key, timeline:property-clear,
timeline:edit-event, timeline:delete-event, timeline:clear-node, timeline:rename-node
```

### Lifecycle / misc (scene panel)

```
scene:is-ready, scene:new-scene, scene:saved, scene:play-on-device,
scene:reload-on-device, scene:preview-server-scene-stashed,
scene:load-package-scene-script, scene:unload-package-scene-script,
scene:stash-and-reload, scene:soft-reload, scene:enter-prefab-edit-mode,
scene:stash-and-save, scene:print-simulator-log,
scene:generate-texture-packer-preview-files,
scene:query-texture-packer-preview-files, scene:export-particle-plist,
scene:ready, scene:reloading,
scene:node-component-added, scene:node-component-removed,
scene:node-component-updated,
scene:generate-texture-packer-preview-files (duplicate), scene:query-texture-packer-preview-files
```

> Verified: chỉ `scene:query-hierarchy/query-node/query-node-info/query-node-functions/query-nodes-by-comp-name` + `scene:stash-and-save` (via `editorOperate`) đã pass. Còn lại là **candidate** cho Phase 2 probe — nhiều là panel-internal, probe fail là bình thường.

---

## §6 Editor internals — `Editor.*` / `electron-ipc-plus` / `editor:*`

### `Editor.Ipc`

```js
Editor.Ipc.sendToPanel(panel, msg, ...args, cb);
Editor.Ipc.sendToMain(msg, ...args, cb);
Editor.Ipc.sendToAll(msg, ...args);
// forum tracing snippet:
let func = Editor.Ipc.sendToPanel;
Editor.Ipc.sendToPanel = (n,r,...i)=>{console.log(n,r,...i); return func(n,r,...i)};
```

### `electron-ipc-plus` (forum nêu version)

```
electron-ipc-plus@1.3.4:main2renderer, electron-ipc-plus@1.3.4:reply
@base/electron-base-ipc@1.0.0:broadcast, @base/electron-base-ipc@1.0.0:send-reply, @base/electron-base-ipc@1.0.0:send
```

### `editor:*` broadcast / panel lifecycle

```
editor:panel-run, editor:panel-unload, editor:panel-out-of-date,
editor:ipc-main2panel, editor:ipc-main2renderer, editor:ipc-reply,
editor:window-inspect, editor:dragstart, editor:dragend, editor:reset-layout,
editor:ready, editor:console-failed, editor:console-warn, editor:console-error,
editor:console-clear, editor:console-log, editor:console-success, editor:console-info,
editor:query-ipc-events, editor:record-node-changed,
profile:local-ip, editor:panel-undock, editor:project-profile-updated,
electron-profile:changed, app:global-step-changed,
preview-server:connects-changed, asset-db:watch-state-changed,
compiler:state-changed,
_selection:selected, _selection:unselected, _selection:activated,
_selection:deactivated, _selection:hoverin, _selection:hoverout,
_selection:context, _selection:patch,
onLoad, onSearchAccept, searchCmd, onDestroy,
simple-code:customCmd,
node-library:delete-prefab, node-library:rename-prefab, node-library:set-prefab-icon,
change-filter, delete, rename, show-path, duplicate, filter, hint, hierarchy:hint,
console:query-last-error-log, editor:console-on-device-play
// + forum extra (already in §5 for scene):
scene:ready, scene:reloading (duplicate listing)
```

---

## §7 Debugging — breakpoint tips (forum)

- Trace send side: breakpoint `ipcRenderer.send` in `C:\CocosCreator\resources\electron.asar\renderer\api\ipc-renderer.js` (case-sensitive).
- Trace receive side: breakpoint `EventEmitter.prototype.emit` in `/events.js` (panel process).
- Log all panel messages: wrap `Editor.Ipc.sendToPanel` as above, or wrap `Editor.Ipc.sendToMain` similarly.
- Forum note: file `C:\CocosCreator\resources\electron.asar\rendere...` is inside asar — unpack with `npx asar extract` or inspect via DevTools `Sources`.

> Repo tương ứng: `GET /debug-logs` + `UTCP_DEBUG=1` → `~/.utcp-debug/*.jsonl` (main) + `scene-console-*.jsonl` (scene `startCatchAll`).

---

## §8 Panel DOM tips (forum — renderer DevTools on `scene`, `tools`, `inspector`, `toolbar`)

```js
panel = document.getElementById("tools");
panel.transformTool = "move"; // also: rotate, scale, rect

mm = document.getElementById("scene");
mm._newScene();
mm._onAlignTop(); // top align

mm = document.getElementById("inspector");
mm._clear(); // clear panel display

document.getElementById("toolbar").__vue__.$data.url;
document.getElementById("playButtons").dataHost.previewURL;

mm = document.getElementById("scene"); // also: document.getElementById("tools"), "inspector"
```

> Không port thành tool — DOM panel là unstable internal, chỉ dùng khi debug trong DevTools.

---

## §9 Links

- Original forum: https://forum.cocos.org/t/topic/92605
- Original post page: https://forum.cocos.org/t/topic/92605/5
- Docs (forum referenced):
  - `https://docs.cocos.com/creator/manual/zh/extension/api/asset-db/asset-db-renderer.html`
  - `https://docs.cocos.com/creator/manual/zh/extension/api/asset-db/asset-db-main.html`
  - `https://docs.cocos.com/creator/manual/zh/extension/api/editor-framework/share/selection.html`
  - `https://docs.cocos.com/creator/manual/zh/extension/asset-management.html`
  - `https://docs.cocos.com/creator/manual/zh/extension/api/editor-framework/`
  - `https://www.electronjs.org/docs` (IPC)
- Verified companion: `api-2x-reference.md` (gap table + probe results), `cocos-2x-api-notes.md` (6 traps + probe C.1)

---

*Generated from WebFetch excerpts (grouped paraphrase, 125-char limit per excerpt). For verbatim forum prose, open the original link. For verified API truth, see `api-2x-reference.md` + `cocos-2x-api-notes.md`.*
