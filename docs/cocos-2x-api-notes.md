# Cocos 2.4.15 API notes — kết quả verify runtime

Ghi từ chạy thật trên Creator 2.4.15, không phải suy luận từ docs. Phase sau đọc file này.

**Editor:** `C:\ProgramData\cocos\editors\Creator\2.4.15`
**Testbed:** `G:\_ws\_helpers\cc-2x-testbed` (từ template `hello-world`)
**Install:** junction `<project>\packages\cocos-code-mode` → `G:\_ws\_helpers\cc-code-mode-cst-2x`

---

## Phase 2 — host shim

### Plugin load

Manifest 2.x tối giản đủ để load (`name`/`version`/`main`/`reload`). Không cần `panel`, `main-menu`, `uuid`.

```
success: cocos-code-mode loaded
normal: [cocos-code-mode] UTCP Server started on port 59142
```

`GET http://127.0.0.1:<port>/utcp` → `{utcp_version:"1.0.1", manual_version:"1.0.0", tools:[]}`

### Junction KHÔNG gây reload loop

`New-Item -ItemType Junction` vào `<project>\packages\` — 4 lần restart, không loop. `reload.ignore: ["node_modules/**/*"]` đủ. (Unresolved #3 phase 2 → resolved.)

### `Editor.Profile` — KHÔNG cần `register()`

`Editor.Profile.load('profile://project/cocos-code-mode.json', {...})` chạy thẳng, không throw. Editor register sẵn type `project`. File đẻ ra ở `<project>/settings/cocos-code-mode.json`.

(Unresolved #2 phase 2 + rủi ro "Profile 2.x cần register trước load" → resolved, không cần fallback đọc `settings/project.json` bằng `fs`.)

### ⚠️ Profile object: PHẢI dùng `.set()`, gán thẳng property KHÔNG persist

Docs (`main/profile.md`) chỉ nói "profile.foo = 'hello foo'; profile.save()". **Sai với 2.4.15.**

Probe runtime:
```
own   = ["_events","_eventsCount","_maxListeners","_type","_file","_chain","getSelfData","reload","clear","mergeData","serverPort"]
proto = ["constructor","get","set","remove","save","clear","reset"]
```

Object là **EventEmitter có `_chain`**. `save()` serialize `_chain` / `getSelfData()`, **không đọc own-property**. Gán `profile.serverPort = 59142` rồi `save()` → file vẫn ghi `serverPort: 0`.

Đúng:
```ts
profile.set('serverPort', 59142);
profile.save();
const port = profile.get('serverPort');
```

Verified round-trip: restart editor → đọc lại đúng `59142`, server bind lại cùng port.

---

## API sai vị trí / sai tên (docs-verified, phát hiện khi viết typings)

| Plan giả định | Thực tế | Nguồn |
|---|---|---|
| `Editor.projectPath` | `Editor.Project.path` | `working-directory.md` (`Editor.projectPath` = 0 hit) |
| `assetdb.queryInfoByUuid` / `queryMetaInfoByUuid` | **RENDERER-only.** Main process dùng `assetInfoByUuid()` / `loadMetaByUuid()` — **sync**, không callback | `asset-db-renderer.md` vs `asset-db-main.md` |
| `Editor.Ipc.sendToPackage` | **RENDERER-only.** Main dùng `sendToMain('<pkg>:msg')` | `renderer/ipc.md` vs `main/ipc.md` |
| `Editor.versions` "chưa có doc" | Có doc, khai non-optional | `main/editor.md` |

⚠️ **Ảnh hưởng phase 4:** `assetQuery info|meta` dùng API **sync**, không cần wrap Promise. `ipc-promise.ts` chỉ cần cho `queryAssets` / `queryMetas` / `deepQuery` / `refresh`.

Delta manifest / build scope / typings: xem `cocos-2x-port-architecture.md`.

---

# Phase 3 — probe engine API (VERIFIED runtime)

**Probe date:** 2026-08-06 · **Creator:** 2.4.15 · **Scene:** `helloworld.fire` (template hello-world)
**Cách chạy:** `main.ts` bắt broadcast `scene:ready` → `callSceneScript` → ghi `probe-result.json`.
**Kết quả:** `errors: []` cả 2 lượt probe. Mọi dòng dưới là dữ liệu thật, không suy đoán.

## `callSceneScript` signature — CONFIRMED

`Editor.Scene.callSceneScript(pkg, msg, ...args, cb)` — gửi `'x', 42, {k:1}` → handler nhận `argCount: 3`, đúng thứ tự, object nguyên vẹn. (Unresolved #2 plan gốc → resolved.)

Handler shape: `function (event, ...args)`, reply bằng `event.reply(null, data)`.

## Xác nhận TỒN TẠI (đều đúng như dự đoán)

| API | Kiểu | Ghi chú |
|---|---|---|
| `cc.director.getScene()` | object | `name`, `uuid`, `children` |
| `node._components` | array | luôn có, `[]` nếu rỗng |
| `node.getComponent` / `getComponents` | function | |
| `cc.js.getClassName(comp)` | function | trả `"cc.MeshRenderer"` — dùng được cho **component**, không chỉ asset |
| `cc.js.getClassByName` / `isChildClassOf` | function | |
| `cc.js._registeredClassNames` | object | **count = 230**, sample `cc.Vec2`, `cc.Texture2D`… |
| `node.angle` **và** `node.rotation` | number | **cả hai cùng tồn tại** ở 2.4.15, không phải rename |
| `node.x/y/scaleX/scaleY/width/height/anchorX/anchorY` | number | |
| `node.uuid` / `active` / `activeInHierarchy` | string / bool / bool | |
| `cc.Object.Flags` | object | 21 flag — xem §filter dưới |
| `_Scene` | object | 30 key. `_Scene.currentScene` là **function**, trả scene object |
| `Editor` trong scene process | object | có `Ipc`, `Selection`, `Undo`, `Profile`, `Panel`… |

## ⚠️ `cc.engine` TỒN TẠI — corpus sai

Plan ghi "0 hit toàn corpus 29k row → có thể không tồn tại". **Sai.** `cc.engine` là object thật, có `editingRootNode`, `attachedObjsForEditor`, `_designWidth/_designHeight`, và prototype có `getInstanceById`, `playInEditor`, `tickInEditMode`, `setDesignResolutionSize`.

**Bài học:** `search_exact` 0 hit = **docs không nhắc tới**, KHÔNG PHẢI "không tồn tại". Corpus chỉ cover editor extension API, không cover engine internals. Rule #2 của plan cần sửa lại theo nghĩa này.

⚠️ **`cc.engine.getInstanceById(uuid)`** — nhiều khả năng là lời giải cho Unresolved #6 (vòng 2: resolve node-by-uuid trong scene process). Chưa verify, để vòng 2.

## ⚠️ BẪY 1: `cc.view.getDesignResolutionSize()` KHÔNG phải design resolution

Trả `978×322` = **kích thước viewport editor tại thời điểm gọi**, đổi theo cách kéo cửa sổ. Design resolution thật của project là `960×640`, nằm ở:

```js
cc.find('Canvas').getComponent('cc.Canvas').designResolution   // {width: 960, height: 640}
```

`cc.view._designResolutionSize` và `_originalDesignResolutionSize` **cũng** trả 978×322 → cả 3 đều sai. **Phase 7 `editorEnvInfo` PHẢI đọc từ `cc.Canvas`**, nếu không sẽ trả số vô nghĩa cho agent.

## ⚠️ BẪY 2: scene root có 2 node của EDITOR, phải filter

`scene.children` = 3, nhưng Hierarchy panel chỉ hiện **1** (`Canvas`):

| name | objFlags | thật? |
|---|---|---|
| `Editor Scene Background` | 1096 | ✗ editor-only |
| `Canvas` | 0 | ✓ |
| `Editor Scene Foreground` | 1096 | ✗ editor-only |

`1096 = HideInHierarchy(1024) + LockedInEditor(512)?` → thực tế `1024 + 64(DontDestroy) + 8(DontSave) = 1096`.

**Filter chuẩn cho phase 6 `sceneSnapshot`:**
```js
function isEditorNode(node) {
    return !!(node._objFlags & cc.Object.Flags.HideInHierarchy);   // 1024
}
```

Không filter → cây trả về lệch hẳn Hierarchy panel, và node đầu tiên agent thấy là `Editor Scene Background` (đúng như probe 1 vấp phải: `node_shape` dump nhầm node editor, `component_shape` trả `cc.MeshRenderer` của Scene Grid — **không có trong scene thật**).

Gate phase 6 ("cây khớp Hierarchy panel") **sẽ fail** nếu bỏ qua điều này.

## Node shape thật (2.4.15)

Field public đọc qua getter; storage là private `_`-prefix:

```
_name _objFlags _parent _children _active _components _prefab
_opacity _color _contentSize _anchorPoint _position _scale _trs
_eulerAngles _skewX _skewY _zIndex _localZOrder _is3DNode _groupIndex
_scaleX _scaleY _activeInHierarchy _id _widget _renderComponent
_matrix _worldMatrix _cullingMask _renderFlag ...
```

⚠️ `node.uuid` là **getter** trả `_id`; `Object.keys(node)` không thấy `uuid`/`name`/`x`/`y`. Dump bằng `Object.keys` sẽ **mất hết field public** → phase 5/6 phải liệt kê field tường minh, không enumerate.

## Component shape thật

```
_name _objFlags node _enabled _materials ...   (+ field riêng theo class)
```
`comp.uuid` (string), `comp.enabled` (bool), `comp.node` (object), `cc.js.getClassName(comp)` → `"cc.MeshRenderer"`.

## Ảnh hưởng thiết kế

**Phase 5/6:**
- Filter `_objFlags & 1024` ở mọi chỗ traverse — nếu không, cây sai
- Liệt kê field tường minh, KHÔNG `Object.keys(node)`
- `angle` + `rotation` cùng có → trả cả hai
- `_is3DNode` phân biệt node 2D/3D
- `cc.js.getClassName` là cách chuẩn lấy tên component

**Phase 7:**
- `editorEnvInfo` design resolution ← `cc.Canvas.designResolution`, KHÔNG `cc.view.*`
- `cc.js._registeredClassNames` (230) → `componentQuery classes`

**Vòng 2:**
- `cc.engine.getInstanceById(uuid)` — ứng viên resolve node-by-uuid
- `_Scene.Undo`, `_Scene.PrefabUtils`, `_Scene.SceneUtils` có sẵn trong scene process

---

# Phase 4 — assetdb API (VERIFIED runtime)

**Probe date:** 2026-08-06 · Testbed `hello-world` (146 asset, 2 mount: `assets` + `internal`)
**Gate:** 19/19 curl pass.

## `Editor.assetdb` CÓ SẴN global trong main process

Không cần `require`. Gọi thẳng `Editor.assetdb.urlToUuid(...)` trong `main.js` plugin. (Unresolved #1 phase 2/4 → resolved.)

## ⚠️ BẪY 3: `deepQuery` trả FLAT list, docs khai `children` là SAI

`asset-db-main.md` ghi `// result.children - the array of children result`. **Không đúng với 2.4.15.**

Runtime keys (probe `Object.keys(result[0])`):
```
uuid  parentUuid  name  extname  type  isSubAsset  hidden  readonly
```

Không có `children`. 146 entry phẳng, quan hệ cha-con nằm ở `parentUuid`. Root = node có `parentUuid` không nằm trong tập kết quả (2 mount: `mount-assets`, `mount-internal`).

Tin docs → cây trả về là **list phẳng 146 phần tử với `childrenCount: 0` toàn bộ** — sai mà không throw. Phải tự build:

```js
// group theo parentUuid, walk tu root ''
const byParent = new Map();
const known = new Set(flat.map(n => n.uuid));
for (const n of flat) {
    const p = n.parentUuid && known.has(n.parentUuid) ? n.parentUuid : '';
    (byParent.get(p) || byParent.set(p, []).get(p)).push(n);
}
```

Cây đúng của testbed: `assets` (4 con) + `internal` (9 con); sprite-frame là con của `.png`.

## ⚠️ BẪY 4: `loadMeta*()` trả LIVE object có circular ref

`loadMetaByUuid(uuid)` / `loadMeta(url)` trả object nội bộ của asset-db, chứa `_uuid2meta` trỏ ngược lại toàn bộ registry → `JSON.stringify` throw `Converting circular structure to JSON`. Tool trả HTTP 500 dù API "chạy được".

`loadMeta` **0 hit** trong corpus → không có nguồn cho `dump()`/`serialize()`. Giải pháp dùng: đọc thẳng file `<fspath>.meta` (JSON thuần trên đĩa, cùng nguồn dữ liệu, kèm được `mtime`).

```js
const metaPath = `${Editor.assetdb.uuidToFspath(uuid)}.meta`;
JSON.parse(fs.readFileSync(metaPath, 'utf8'));
```

Shape thật (texture): `{ver, uuid, importer, type, wrapMode, filterMode, premultiplyAlpha, genMipmaps, packable, width, height, platformSettings, subMetas:{...}}`.

## `queryAssets` — assetTypes nhận `null` = mọi type

`queryAssets(pattern, null, cb)` chạy, trả tất cả. Không cần liệt kê type. (Unresolved #3 phase 4 → resolved.)

Result shape runtime — docs khai 5 field, thực tế **8**:
```
url  path  uuid  type  isSubAsset  readonly  hidden  destPath
```
`destPath` = `library/imports/...`, `null` cho folder.

## `assettype2name` — hướng `{className: typeName}`

`Editor.assettype2name['cc.Texture2D'] === 'texture'`. 31 unique type name. (Unresolved #2 phase 4 → resolved.)

```
animation-clip audio-clip bitmap-font buffer dragonbones dragonbones-atlas
effect fbx font javascript json label-atlas material mesh native-asset
particle physics-material prefab scene script skeleton skeleton-animation-clip
spine sprite-frame text texture texture-packer tiled-map ttf-font typescript video-clip
```

⚠️ `queryAssets` cần **type name** (`'texture'`), không phải class name (`'cc.Texture2D'`).

## `assetInfo` / `subAssetInfos` — sync, đúng như docs

`assetInfo(url)` → `{uuid, path, url, type, isSubAsset}`. `subAssetInfos('db://assets/Texture/HelloWorld.png')` → 1 sprite-frame, url là `<png-url>/<name>` (không extension).

---

## Unresolved

1. ~~`Editor.assetdb` có sẵn global trong main.js plugin hay phải require?~~ → **resolved phase 4: có sẵn**
2. `cc.engine.getInstanceById(uuid)` có resolve được node không — chưa verify (vòng 2)
3. Vòng 2 undo: `Editor.Undo.add + commit` hay `_Scene.Undo`?
4. Vòng 2 write meta: `saveMeta(uuid, jsonString)` — ghi qua API hay ghi thẳng file `.meta`? (đọc thì file thắng vì circular ref, ghi thì có thể phải qua API để asset-db reimport)

