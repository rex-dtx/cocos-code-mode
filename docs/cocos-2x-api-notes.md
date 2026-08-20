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
normal: [cocos-code-mode-2x] UTCP Server started on port 59142
```

`GET http://127.0.0.1:<port>/utcp` → `{utcp_version:"1.0.1", manual_version:"1.0.0", tools:[]}`

### Junction KHÔNG gây reload loop

`New-Item -ItemType Junction` vào `<project>\packages\` — 4 lần restart, không loop. `reload.ignore: ["node_modules/**/*"]` đủ. (Unresolved #3 phase 2 → resolved.)

### `Editor.Profile` — KHÔNG cần `register()`

`Editor.Profile.load('profile://project/cocos-code-mode-2x.json', {...})` chạy thẳng, không throw. Editor register sẵn type `project`. File đẻ ra ở `<project>/settings/cocos-code-mode-2x.json`.

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

# Phase 5 — scene IPC message (VERIFIED runtime)

**Probe date:** 2026-08-06 · Scene `helloworld.fire` · Gate 8/8 curl pass.
Gọi qua `Editor.Ipc.sendToPanel('scene', msg, ...args, cb)` (`sceneIpc()` helper).

## Message nào THẬT SỰ tồn tại

| Message | Runtime | Ghi chú |
|---|---|---|
| `scene:query-hierarchy` | ✅ | `(err, sceneID, hierarchy)` — 2 giá trị, đúng docs |
| `scene:query-node` | ✅ | trả **string** → `JSON.parse` |
| `scene:query-node-info` | ✅ | arg 2 = `'cc.Node'` |
| `scene:query-node-functions` | ✅ | |
| `scene:query-nodes-by-comp-name` | ✅ | |
| `scene:query-animation-node` | ❌ **KHÔNG TỒN TẠI** | `ipc failed to send, message not found` |

⚠️ Docs (`reference/ipc-reference.md`) liệt kê `scene:query-animation-node` nhưng runtime 2.4.15 không có handler. Op `animation_root` đã bỏ, thay bằng `by_component`.

**Không enumerate được message thật:** package `scene` nằm trong `app.asar`, file `.ccc` mã hoá. `resources/builtin/` chỉ có 11 package phụ (adapters, package-manager…), không có `scene`. → phải test từng message bằng runtime.

## `scene:query-hierarchy` — NESTED, có `hidden`, KHÔNG có components/transform

```json
[
  {"name":"Editor Scene Background","id":"c4lE8kiM9Glapjx3lGXrF9","hidden":true,
   "prefabState":0,"locked":false,"isActive":true,
   "children":[{"name":"Scene Grid","id":"039X4VbftEzLlEKRk4Qsn4","hidden":false,"...":"..."}]},
  {"name":"Canvas","id":"a286bbGknJLZpRpxROV6M94","hidden":false,"children":[
     {"name":"Main Camera"},{"name":"background"},{"name":"cocos"},{"name":"label"}]},
  {"name":"Editor Scene Foreground","id":"52NR2srwpNbZ4byz9MXd9K","hidden":true}
]
```

Key mỗi node: `name` `id` `children` `prefabState` `locked` `isActive` `hidden`.

⚠️ **`id` là compressed uuid** (`a286bbGknJLZpRpxROV6M94`), KHÔNG phải uuid dạng dash. Truyền thẳng lại cho `scene:query-node` là chạy.

⚠️ **`sceneID` = uuid của scene ASSET** (`2d2f792f-…` = `helloworld.fire`), không phải node id.

### Filter editor node ở phase 6: dùng `hidden`, không cần bitmask

`hidden: true` cho `Editor Scene Background` / `Editor Scene Foreground`, `false` cho `Canvas` — khớp Hierarchy panel. Đơn giản hơn `_objFlags & 1024` của scene-script.

⚠️ Con của editor node có `hidden: false` (`Scene Grid`, `Design Resolution`) → phải filter **ở root**, không filter từng node.

### ✅ Ảnh hưởng phase 6: KHÔNG khỏi được scene-script

`query-hierarchy` **không** trả components/transform — chỉ 7 field trên. Phase 6 `sceneSnapshot` muốn kèm component + position vẫn phải traverse trong scene-script. (Câu hỏi §5.2 của plan → trả lời: **không tiết kiệm được file**.)

## `scene:query-node` dump — value wrapper `{type, value}`, giống 3.x

Top level **2 key**: `types` (12 class def) + `value`.

```json
{"types": {"cc.Node":{},"cc.Vec2":{},"cc.Canvas":{},"280c3rsZJJKnZ9RqbALVwtK":{}},
 "value": {
   "__type__":"cc.Node",
   "name":     {"type":"String",  "value":"Canvas"},
   "position": {"type":"cc.Vec2", "value":{"x":480,"y":320}},
   "size":     {"type":"cc.Size", "value":{"width":960,"height":640}},
   "color":    {"type":"cc.Color","value":{"r":252,"g":252,"b":252,"a":255}},
   "__comps__":[ {"type":"cc.Canvas", "value":{}} ]
 }}
```

`value` keys: `__comps__` `__type__` `active` `anchor` `angle` `color` `eulerAngles` `group` `is3DNode` `name` `opacity` `position` `scale` `size` `skew` `uuid`.

- **Có `__comps__` sẵn** — mỗi comp `{type, value}`, `type` là class name hoặc **script uuid** (`280c3rsZJJKnZ9RqbALVwtK` = `HelloWorld.js`).
- Canvas testbed: 3 comp — `cc.Canvas` (17 prop), script (13), `cc.Widget` (50).
- `cc.Canvas.designResolution` = `{width:960, height:640}` — **khớp giá trị thật**, khác `cc.view` (bẫy 1). Đây là nguồn thứ 2 cho `editorEnvInfo` phase 7, không cần vào scene-script.
- ⚠️ **Nặng: 19 KB cho 1 node Canvas** (`types` chiếm phần lớn). Phase 6/7 gọi hàng loạt phải cân nhắc; token guard hiện chưa cắt `types`.

## `scene:query-node` với uuid sai → KHÔNG throw

`uuid=deadbeef` → HTTP **200** `{"types":{},"value":null}`. Agent phải tự check `value === null`, không dựa vào error.

## `scene:query-node-info`

```json
{"name":"Canvas","missed":false,"nodeID":"a286bbGknJLZpRpxROV6M94","compID":null,"compIDList":[]}
```
Mỏng. `missed` là cờ node-không-tồn-tại.

## `scene:query-node-functions`

```json
{"cc.Canvas":["applySettings","addComponent","destroy","schedule"],
 "HelloWorld":["addComponent","destroy"],
 "cc.Widget":["updateAlignment","addComponent"]}
```
Record `{componentName: methodName[]}`. Script comp dùng **tên class** (`HelloWorld`), khác `__comps__` dùng **uuid**.

## `scene:query-nodes-by-comp-name` → mảng uuid TRẦN

```
cc.Sprite  -> ["e2e0crkOLxGrpMxpbC4iQg1","c4f30YOS65G64U2TwufdJ+2"]
cc.Label   -> ["31f1bH7V69Ajr1iXhluMpTB"]
```

Không có name/path → agent phải `dump` từng cái. (Unresolved #3 phase 5 → resolved: **uuid trần**, nên phase 6 `find-by-component` trả kèm path là có giá trị thật.)

---

# Phase 6 — deep read qua scene-script (VERIFIED runtime)

**Probe date:** 2026-08-06 · Gate 14/14 curl pass · `sceneSnapshot` default = **1980 B** (gate < 50 KB).

## ⚠️ BẪY 5: query parser custom KHÔNG chạy — mọi arg number về tool là STRING

`utcp-server.ts` (kế thừa 3.x) gọi `app.set('query parser', …)` **sau** `app.use(cors())`. Express bind `query parser fn` lúc `lazyrouter()` chạy — tức ở `use()` **đầu tiên**. Set sau đó không có tác dụng.

Hậu quả: `?maxDepth=2` về tay tool là `"2"` (string). `typeof x === 'number'` false → luôn rơi về default. **Không throw, không warn** — tool chạy, trả JSON hợp lệ, chỉ là ignore tham số.

Phase 4 không lộ vì JS tự coerce: `arr.slice(0, "3")` vẫn ra 3 phần tử. Phase 6 lộ vì có so sánh `typeof`.

**Fix:** `app.set('query parser', …)` phải đứng **trước mọi `app.use()`**.

```ts
async start(port) {
    this.app.set('query parser', ...);   // TRUOC
    this.app.use(cors());                 // SAU
}
```

Verify: `_debugOpts` echo `{"maxDepth": 2}` kiểu `int`, trước fix là `"2"` kiểu `str`.

## ⚠️ Arg của `callSceneScript`: bọc trong object

Phase 3 verify `callSceneScript(pkg, msg, ...args, cb)` truyền được 3 arg. Nhưng arg **number ở vị trí cuối** rủi ro — IPC 2.x đọc arg cuối làm timeout. Quy ước dùng: **1 object duy nhất**.

```ts
sceneScript('scene-snapshot', { maxDepth: 3 });      // OK
sceneScript('node-at-path', { path: 'Canvas', maxDepth: 3 });
```

## ⚠️ BẪY 6: asset ref — `cc.SpriteFrame.uuid` là getter kế thừa

`component-props` ban đầu detect ref bằng `typeof v === 'object' && v.uuid`. `cc.SpriteFrame` trượt qua check này → rơi vào `JSON.stringify` → **`"<circular>"`**. Mất hẳn thông tin asset nào đang gán.

Detect đúng bằng `instanceof`:

```js
function isRefLike(v) {
    return (cc.Asset && v instanceof cc.Asset)
        || (cc.Node && v instanceof cc.Node)
        || (cc.Component && v instanceof cc.Component);
}
function asRef(v) {
    return { __ref: v.uuid || v._uuid || null, __type: className(v), __name: v.name || null };
}
```

⚠️ `v.uuid` **vẫn null** cho `cc.SpriteFrame` → phải fallback `v._uuid`.

⚠️ `materials` là **array asset** — phải map từng phần tử, không stringify cả mảng.

Kết quả cross-check với phase 4:
```
componentQuery props -> spriteFrame.__ref = 31bc895a-c003-4566-a9f3-2e54ae1c17dc
assetQuery sub_assets -> 31bc895a-c003-4566-a9f3-2e54ae1c17dc  db://assets/Texture/HelloWorld.png/HelloWorld
```
Ref của scene nối thẳng sang asset db — agent đi được từ node → asset → file content.

## `sceneSnapshot` — filter editor node bằng `_objFlags`

Trong scene-script dùng bitmask (khác `nodeQuery.tree` dùng field `hidden` của scene panel):
```js
node._objFlags & cc.Object.Flags.HideInHierarchy   // 1024
```
Chỉ filter **ở root**. Cây trả về khớp Hierarchy panel: 1 root `Canvas`, 4 con.

Field mỗi node: `name` `uuid` `active` `activeInHierarchy` `is3D` `position` `scale` `angle` `size` `anchor` `components[{type,uuid,enabled}]` `childrenCount` + (`children` | `truncated`).

`designResolution` lấy từ `cc.Canvas` (bẫy 1) → `{width:960, height:640}` đúng.

## `component-props` — `for...in` an toàn

Skip `_private`, skip function, try/catch mỗi getter. Field runtime-only lộ ra: `update` `lateUpdate` `onLoad` `start` `onFocusInEditor` `onLostFocusInEditor` `resetInEditor` = `null`, `isValid` = true. Vô hại nhưng nhiễu.

## `find-by-component` vs `by_name`

| | Trả về |
|---|---|
| `find` (scene-script) | `[{path:"Canvas/background", uuid, name}]` — **dùng được với `cc.find()`** |
| `by_name` (scene panel IPC) | `["e2e0crkOLxGrpMxpbC4iQg1", …]` uuid trần |

`find` path bắt đầu từ root node, **không gồm tên scene** — khớp cú pháp `cc.find()`.

---

# Phase 7 — editor misc + FINAL

**Probe date:** 2026-08-06 · Smoke test toàn bộ: **34/34 pass**, 9 tool.

## `Editor.versions` shape thật

```json
{"CocosCreator":"2.4.15","editor-framework":"0.7.0","asset-db":"0.2.3","cocos2d":"2.4.15"}
```

Key là **`CocosCreator`** (PascalCase), không phải `cocos-creator`/`editor`. Engine ở `cocos2d`. (Unresolved #3 phase 7 → resolved.)

Runtime: node `14.16.0`, electron `13.1.4` (`process.versions` — luôn có, không cần API editor).

## `Editor.Selection.select` NHẬN ARRAY

Docs khai `select(type, id: string, …)`. Runtime nhận cả array — không cần loop. (Unresolved #2 phase 7 → resolved.)

Round-trip verified: `select` → `query` thấy uuid → `unselect` → rỗng. `curActivate` trả uuid vừa chọn, `hovering` null khi chuột không trên node.

## ❌ BỎ `editorGetLogs` — 2.4.15 không có API đọc console

Thử 3 message trên panel `console`, **3/3 fail**:
```
console:query-logs -> ipc failed to send, message not found
console:query      -> ipc failed to send, message not found
logs               -> ipc failed to send, message not found
```

Docs `main/console.md` chỉ có `log`/`warn`/`error`/`clearLog` — **ghi**, không đọc. Tool đã xoá khỏi code và khỏi `code-mode-references-2x.d.ts`. User xem Console panel trực tiếp. (Unresolved #1 phase 7 → resolved: không có.)

## `projectGetConfig` — đọc thẳng `settings/*.json`

`Editor.Profile.load` trả EventEmitter không serialize được (bẫy 4). Đọc file trực tiếp. Testbed có 5 file: `builder` `builder.panel` `cocos-code-mode` `project` `services`.

Trả kèm `available` để agent biết `type` nào hợp lệ, không phải đoán.

---

# Tool surface vòng 1 (read-only) — FINAL

| Tool | Ops | Nguồn API |
|---|---|---|
| `assetResolve` | uuid_from_url · url_from_uuid · fspath · exists | `Editor.assetdb.*` sync |
| `assetQuery` | search · tree · info · meta · types · sub_assets · used_by | `assetdb` sync + `queryAssets`/`deepQuery` async + `fs` (.meta) + scene-script (`used_by`) |
| `assetReadContent` | — | `assetdb` → `fs.readFileSync` |
| `nodeQuery` | tree · dump · info · functions · by_component · at_path | scene panel IPC (5) + scene-script (at_path) |
| `sceneSnapshot` | — | scene-script `cc.*` traverse |
| `componentQuery` | props · classes · by_name · find | scene-script (3) + scene panel IPC (by_name) |
| `listComponentMethods` | — | `scene:query-node-functions` (main process IPC), normalized to v3 shape |
| `editorSelect` | query · select · unselect · clear | `Editor.Selection.*` |
| `editorEnvInfo` | — | `Editor.versions` + `Editor.Project.path` + `process.versions` |
| `projectGetConfig` | — | `fs` đọc `<project>/settings/*.json` |

**10 tool, 27 op.** Mutation duy nhất: `editorSelect` (selection, không phải scene).

Op thứ 27 là `assetQuery used_by` (vòng 1.2) — chiều ngược asset → node, không cần API mới. Cơ chế + giới hạn + trạng thái smoke: xem **§6 `find-by-asset`** ở phần vòng 1.2 dưới.

Tool thứ 10 (`listComponentMethods`, port từ v3 commit `9fc494b`) thêm vào sau vòng 1.2 — discovery cho callComponentMethod vòng 2. Output group theo component NAME (không có uuid): message `scene:query-node-functions` trả record `{componentName: methodName[]}`. Khi cần component uuid, lấy từ `nodeQuery dump.__comps__`.

## Bỏ khỏi vòng 1

Tách làm 2 loại. Bản trước gộp chung thành *"14 tool — port vòng 2"*, **sai**: một phần không bao giờ port được, để lẫn vào nợ kỹ thuật khiến lần sau lại đi tra lại từ đầu.

### Còn nợ thật — port vòng 2

| Tool | Lý do |
|---|---|
| 45 tool ở 9 file (`source/utcp/tools/`) | dùng `Editor.Message.request` (không có ở 2.x) nhưng **còn khả thi** qua scene-script — chờ vòng 2 |
| 19 asset importer | `.meta` format 3.x |

### Đóng sổ — KHÔNG port được, đừng tra lại

| Nhóm | Tool | Vì sao không port được |
|---|---|---|
| Console | `editorGetLogs` | 2.4.15 không có API đọc console — verified 3/3 message candidate fail |
| Build | `buildTrigger` `buildTaskControl` `buildGetTask` `buildGetTasksInfo` `buildPanelOpen` | `Editor.Builder` 2.4 **chỉ có `on`/`once`/`removeListener`** — event hook, không có API trigger build. Nguồn: corpus `v2.4/extension/api/editor-framework/main/builder.md` |
| Animation | `animationQuery` `animationEdit` | `scene:query-animation-node` verified **không tồn tại** ở 2.4.15 (phase 5) |
| Typings | `typescript-defenition` (2 tool) | Sinh `.d.ts` từ property dump 3.x. 2.x thay bằng `code-mode-references-2x.d.ts` viết tay — **có chủ đích**, không phải nợ |
| Asset dep graph | `assetFindReferences` (commit `8094c9c`) | Hand-written `@types/editor-2x/index.d.ts` liệt kê toàn bộ assetdb API verified từ docs: **không có method nào cho reference/dependency query** (`queryImports`/`queryReferences`/`queryUsedBy`). 2.x meta format không có block imports như 3.x → không port được |
| Array element ops | `propertyArrayElement` (commit `8094c9c`) | Write op — chặn cứng vòng 2 (undo + set-property-by-path chưa verify) |
| Editor introspect | `editorIntrospect` categories `scene_mode` / `ready` / `enum_values` / `script_info` (commit `8094c9c`) | Map sang 6 message scene panel (`query-scene-mode`, `query-is-ready`, `query-enum-list-with-path`, `query-layer-builtin`, `query-sorting-layer-builtin`, `query-script-name/cid`) — **tất cả chưa verify trên 2.4.15**. Không nằm trong bảng Phase 5 (6 message đã test). Probe cần thiết trước khi code. `sorting_layers` đặc biệt: tính năng 3.x, 2.4 dùng groups thay thế (đã khả thi qua `projectGetConfig type=project key=groupList`) |
| Viewport ops | `editorViewport` ops `set_icon_gizmo_3d` / `set_icon_gizmo_size` / `query_viewport.*` (commit `9fc494b`) | 6 message scene panel icon-gizmo/is2D/grid **chưa verify trên 2.4.15**. Mutation ops (`set_*`) còn thuộc vòng 2 scope. Probe cần thiết |

Số thật (đếm `@utcpTool` trong `source/utcp/tools/`, 2026-08-08): **12 file / 55 tool**. Đóng sổ **10 tool**: build 5 + animation 2 + typings 2 + `editorGetLogs` 1. Còn lại **45 tool ở 9 file**.

3 file đóng sổ *hoàn toàn*: `build-tools.ts` · `animation-tools.ts` · `typescript-defenition.ts`. `editor-tools.ts` đóng sổ **một phần** — mất `editorGetLogs`, còn `editorViewport`/`editorOperate`/`editorHistory`/`editorSelect`… vẫn khả thi, nên file vẫn nằm trong nhóm nợ thật.

## Tổng kết: 6 bẫy docs-sai-runtime

| # | Docs nói | Runtime 2.4.15 | Phát hiện ở |
|---|---|---|---|
| 1 | `cc.view.getDesignResolutionSize()` = design resolution | = viewport editor, đổi theo cửa sổ. Thật ở `cc.Canvas.designResolution` | phase 3 |
| 2 | (không nhắc) | scene root có 2 node editor `objFlags 1096`, phải filter | phase 3 |
| 3 | `deepQuery` result có `children` | flat list + `parentUuid` | phase 4 |
| 4 | (không có doc `loadMeta`) | live object circular `_uuid2meta`, không serialize được | phase 4 |
| 5 | (bug của fork 3.x) | `app.set('query parser')` sau `app.use()` → không chạy, arg số về dạng string | phase 6 |
| 6 | (không nhắc) | `cc.SpriteFrame.uuid` là getter kế thừa → check `v.uuid` trượt, phải `instanceof cc.Asset` | phase 6 |

Thêm 2 API docs khai mà **không tồn tại**: `scene:query-animation-node`, `console:query-*`.

✅ **Bẫy 5 đã port ngược sang cả 2 nhánh 3.x** (2026-08-06): `custom` `f3b86ab`, `cc-3x7` `d21acbd` (cherry-pick). Cả 3 nhánh giờ cùng thứ tự đúng.

Chứng minh thực nghiệm (express 4.21.2, không phải suy luận):

```
set AFTER  use()  ->  {"maxDepth":"3", type:"string"}
set BEFORE use()  ->  {"maxDepth":3,   type:"number"}
```

Nguồn gốc ở `node_modules/express/lib/application.js:151` — `lazyrouter()` snapshot setting **1 lần**: `this._router.use(query(this.get('query parser fn')))`, và `app.use()` gọi `lazyrouter()` ở dòng 221. Comment của chính express: *"it reads app settings which might be set after that has run."*

⚠️ **Bug tái phát nếu ai refactor `start()`** — không test nào chặn, không lint được, build vẫn xanh. Comment cảnh báo đã để ngay trên dòng `app.set` ở cả 3 nhánh.

Lưu ý: `package.json` của `custom` khai `express: ^5` nhưng cài về **4.21.2**. Express 5 bỏ `lazyrouter`, cơ chế khác — nếu nâng thật thì phải verify lại.

# Vòng 2 (write) — blocker đã biết

- **resolve node-by-uuid trong scene process:** `cc.engine` TỒN TẠI (corpus sai), prototype có `getInstanceById` — chưa verify có resolve được không
- **undo:** `Editor.Undo.add + commit` hay `_Scene.Undo`? chưa verify
- **write meta:** `saveMeta(uuid, jsonString)` qua API hay ghi thẳng `.meta`? Đọc thì file thắng (circular ref), ghi có thể phải qua API để asset-db reimport
- **`delete`/`import`** là reserved word trong TS namespace → call site `(Editor.assetdb as any)['delete'](urls, cb)`
- Message scene ngoài 5 cái đã verify: **không enumerate được** (`.ccc` mã hoá), chỉ biết bằng cách thử

---

## Unresolved

1. ~~`Editor.assetdb` có sẵn global trong main.js plugin?~~ → **resolved phase 4: có sẵn**
2. ~~`Editor.Selection.select` nhận array hay chỉ string?~~ → **resolved phase 7: nhận array**
3. ~~`Editor.versions` shape?~~ → **resolved phase 7: `{CocosCreator, editor-framework, asset-db, cocos2d}`**
4. ~~`Editor.Console` có API đọc log?~~ → **resolved phase 7: KHÔNG có**
5. `cc.engine.getInstanceById(uuid)` có resolve được node không — chưa verify (vòng 2)
6. Vòng 2 undo: `Editor.Undo.add + commit` hay `_Scene.Undo`?
7. Vòng 2 write meta: qua API `saveMeta` hay ghi thẳng file?
8. ~~`scene:query-node` `types` 12 class def cho 1 node (~19 KB) — có cách xin dump không kèm `types`?~~ → **resolved: cắt ở tool, không cần API mới** (xem §Vòng 1.1)
9. ~~`sceneSnapshot` trên scene production của team (testbed chỉ 5 node / 1980 B). > 50 KB thì hạ default `maxDepth` xuống 4.~~ → **resolved: `maxNodes` 400 chặn theo số node**, không phụ thuộc hình dạng cây (xem §Vòng 1.1 §4). Vẫn nên đo trên scene thật để chốt con số 400.
10. `find-by-component` node trùng tên → path không unique. Cần index `Canvas/Bg[1]`? YAGNI tới khi gặp.
11. Config panel UI chưa port — vòng 1 server tự start, đọc port ở `settings/cocos-code-mode.json`.

---


# Batch HL + BatchProps — 2026-08-19 (e779f38..1349d6d)

**Probe kết luận:** `scene://set-property-by-path:setPropertyByPath` cần **node object** (`setter(node, path, value)` — `ok (node obj)`), gọi `setter(uuid, path, value)` throw `Cannot read property 'constructor' of undefined`. Fix: resolve node via `cc.engine.getInstanceById(uuid)` walk fallback, thử `setter(node, path, value)` rồi fallback `setter(uuid, ...)`. Silent no-op khi path sai → verify `after===value` (và `x`/`y` indirection) rồi fallback direct `cur[last]=value`. Áp dụng cho `set-node-prop-undo`, `scene-set-property`, `batch-property` (`undo:true` branch). `batchSetProperties` verify xong `{x:120,y:60}` trên TestBox `503IBudZ9FqaNQkiuQBZNU`.

**Batch A/B đã ghi ở docs/README.md** — xem đó cho tool surface chi tiết.

# Nguồn thứ 3: engine source + app.asar giải nén

Bổ sung sau vòng 1. Trước đó chỉ có 2 nguồn: corpus `cc_docs` và probe runtime. Nguồn này lấp đúng khoảng trống của corpus (`cc_docs` cover **editor extension API**, KHÔNG cover engine internals).

| Nguồn | Path | Đọc được? |
|---|---|---|
| Engine source | `C:\ProgramData\cocos\editors\Creator\2.4.15\resources\engine\` | ✅ **982 file .js plain, 0 mã hoá** |
| app.asar giải nén | `G:\_ws\cc_2_4_15\app_asar_cc_2_4_15\` | ❌ 893 `.ccc` / 107 `.js` — code editor mã hoá hết |

## Vì sao `.ccc` không mở được offline

`editor-framework/lib/share/require.js` (1 trong số ít file plain) đăng ký `Module._extensions['.ccc']`, decrypt qua:

```js
process._linkedBinding('electron_common_compile').test(file, [...], ...)
```

Native binding của Electron build riêng → offline không gọi được. `.ccc` là **V8 bytecode đã mã hoá**, entropy cao, `strings` ra rác, `grep "scene:query"` toàn asar = **0 hit**. Không có đường decrypt tĩnh.

**Hệ quả:** kết luận phase 5 "message scene không enumerate được" **vẫn đúng**, giờ biết chính xác lý do. Chỉ probe runtime mới ra.

## Xác nhận ngược 3 phát hiện runtime bằng engine source

Cả 3 trước đây chỉ dựa vào probe, giờ có nguồn:

| Phát hiện | File engine | Xác nhận |
|---|---|---|
| Bẫy 2: `HideInHierarchy` = 1024 | `cocos2d/core/platform/CCObject.js:42` | `var HideInHierarchy = 1 << 10;` — đúng |
| Bẫy 1: design res thật ở `cc.Canvas` | `cocos2d/core/components/CCCanvas.js:88` | `designResolution` getter → `cc.size(this._designResolution)` (clone, không phải viewport) — đúng |
| Bẫy 6: phải `instanceof cc.Asset`, fallback `_uuid` | `cocos2d/core/assets/CCAsset.js:59` | `Object.defineProperty(this,'_uuid',{value:'',writable:true})` — **non-enumerable**, comment engine: *"to avoid uuid being assigned to empty string during destroy"*. Nên `JSON.stringify` mất uuid, `_uuid` fallback là bắt buộc — đúng |

Không thấy chỗ nào code vòng 1 lệch so với engine source.

## Unresolved #5 — `cc.engine.getInstanceById` TỒN TẠI

Engine tự gọi, 3 call site trong `cocos2d/core/base-ui/CCWidgetManager.js:274,287,313`:

```js
let component   = cc.engine.getInstanceById(AnimUtils.Cache.component);
var editingNode = cc.engine.getInstanceById(AnimUtils.Cache.rNode);
```

Trả cả Component lẫn Node → resolve theo **instance id**, không giới hạn loại. Vẫn cần probe để biết id đó có bằng `uuid` mà `scene:query-hierarchy` trả không (vòng 2), nhưng API thì hết phỏng đoán.

## `Editor.require('scene://...')` — cửa vào scene module

Engine dùng scheme URL này load helper của scene panel:

```js
Editor.require('scene://utils/animation')   // ×2
Editor.require('scene://utils/prefab')      // ×4
Editor.require('scene://utils/node')        // ×3
Editor.require('scene://utils/physics')     // ×2
Editor.require('scene://edit-mode')         // ×1
Editor.require('app://editor/page/scene-utils/utils/node')  // dạng đầy đủ
```

`scene://` → `app.asar/editor/page/scene-utils/`. Nội dung `.ccc` nhưng **cây tên module đọc được** — bản đồ vòng 2:

```
scene-utils/
├── dump/          get-node-dump · get-node-functions · hierarchy   ← đúng 3 op nodeQuery đang dùng
├── undo/          index · scene-undo-impl                          ← Unresolved #6
├── utils/         node · prefab · scene · animation · material ·
│                  spriteframe · effect · particle · physics/       ← write API vòng 2
├── edit-mode/     index · modes/{animation,prefab,scene}
├── engine-extends/ asset-manager-extends · component-extends · widget-manager-extends
├── lib/           asset-watcher · detect-conflict · engine-events ·
│                  sandbox · source-maps · stash-scene · tasks
├── set-property-by-path.ccc                                        ← ứng viên write property vòng 2
└── reset-node.ccc
```

`dump/hierarchy` + `dump/get-node-dump` + `dump/get-node-functions` khớp 1-1 với 3 message `scene:query-*` đã verify → scene panel chỉ là wrapper mỏng quanh các module này. Scene-script chạy **cùng process** nên gọi thẳng `Editor.require('scene://utils/node')` được, bỏ qua IPC.

**CHƯA VERIFY** — `.ccc` không đọc được signature. Đây là **bản đồ để probe**, KHÔNG phải API đã xác nhận. Probe `Object.keys(Editor.require('scene://utils/node'))` trước khi code.

## Unresolved bổ sung — probe 2026-08-18 (helloworld, 12 nodes)

12. `cc.engine.getInstanceById(id)` — chưa probe `probe-getInstanceById` (Canvas uuid `a286bbGkn...`). Kết luận chờ.
13. `Editor.require('scene://utils/node')` — **đã probe**: KHÔNG có `setProperty`/`setPropertyByPath`. Export: `getObbFromRect, getWorldBounds, getWorldOrientedBounds, getScenePosition, setScenePosition, getWorldPosition, setWorldPosition, getWorldRotation, setWorldRotation, getWorldScale, createNodeFromAsset, createNodeFromClass, getNodePath, makeVec3InPrecision...` — chỉ có transform + create helpers. `set-property-by-path.ccc` nằm top-level `scene-utils/` (thử `scene://set-property-by-path` chưa ra).
14. `set-property` — **đã probe 2 hướng**:
    - `scene://utils/node` → không có. Thử mọi `scene://set-property-by-path` / `app://editor/page/scene-utils/set-property-by-path` → keys khác nhau, chưa match.
    - **Direct `node.x = 999` → 0→999 thành công**, `probe-mutate direct_x 0→1 OK`. Write qua `node[prop] = value` hoạt động trong scene process. Undo chưa verify (probe-undo: `Editor.Undo` / `_Scene.Undo` keys pending detail).
    - `setWorldPosition(uuid, Vec3)` / `setScenePosition` tồn tại — dùng cho position.

→ **Write vòng 2 sẽ đi đường direct assign + `scene:snapshot` undo** (đã verify), không đợi `setPropertyByPath`. Probe `probe-undo` detail cần chạy lại để chốt undo entry point.

---

# Vòng 1.1 — token guard + not-found nhất quán (2026-08-06)

Ba việc làm **không cần Creator chạy**. Lý do: 2.4.15 không mở được lúc làm (12 process đều 3.7.3, port 57025 serve project 3.x), nên mọi thứ cần probe — cả 3 Unresolved #12/#13/#14 và toàn bộ vòng 2 — đều bị chặn. Ba việc dưới đây thuần logic tool, verify bằng `tsc` + đối chiếu shape đã ghi ở phase 5.

## 1. `nodeQuery dump` — bỏ `types` mặc định

Unresolved #8 hỏi "có message nào xin dump không kèm `types`?". **Câu hỏi sai chỗ** — không cần API mới, cắt ở tool là đủ:

```
types omitted (default)  ->  ~2 KB    + typesOmitted: ["cc.Node","cc.Vec2",...]
includeTypes: true       ->  ~19 KB   nguyên bản
```

`types` chỉ là **schema** (12 class def), không phải giá trị. Đọc `value` không dùng đến. Trả `typesOmitted: string[]` (danh sách tên class đã bỏ) thay vì bỏ im lặng — agent biết có gì mà xin lại, không phải đoán.

Ảnh hưởng: quét 20 node từ ~380 KB xuống ~40 KB.

## 2. Not-found → `Error`, hết 3 kiểu sentinel khác nhau

Trước: 3 op báo "không tìm thấy" theo 3 cách khác nhau, không cách nào là error:

| Op | Trả gì khi không thấy | HTTP |
|---|---|---|
| `dump` | `{"types":{},"value":null}` | 200 |
| `info` | `{missed: true, ...}` | 200 |
| `at_path` | `null` | 200 |

Agent phải biết trước cả 3 quy ước mới đọc đúng, và **không quy ước nào tự hiển lộ** — uuid sai vẫn ra 200 nên `try/catch` trượt. Giờ cả 3 throw `Error("Node not found: <uuid|path>")`, khớp với `props`/`find` đã throw từ vòng 1.

⚠️ **Đây là breaking change** cho bất kỳ agent nào đã dựa vào `value === null` / `missed`. Vòng 1 chưa release ra ngoài nên chấp nhận được.

## 3. README viết lại cho 2.x

README vẫn là bản 3.x: 59 tool không tồn tại, "all editor interactions go through `Editor.Message.request`" (API không có ở 2.4), Instance Reference `{id, type}` (2.4 không có handle thống nhất), Config panel (chưa port), phần TypeScript Definitions / Settings Inspection (thuộc tool 3.x đã bỏ).

Viết lại: bảng 9 tool × 26 op, bảng 3 đường vào editor (`assetdb` / `Ipc` / `callSceneScript`) + helper tương ứng, bảng so sánh 3.x↔2.4, mục "Not in round 1", 2 cảnh báo cho người viết tool mới (bẫy query-parser, IPC nuốt number ở cuối). Ảnh `tools_screenshot.jpg` bỏ — UI 3.x.

## Không làm

| | Lý do |
|---|---|
| Tool write bất kỳ | Cần probe #12/#13/#14 — 2.4.15 không chạy |
| Hạ default `maxDepth` (Unresolved #9) | Không cần nữa — `maxNodes` chặn theo số node, xem §4 |
| Index path cho node trùng tên (#10) | YAGNI, chưa gặp |
| Config panel UI (#11) | Cần Creator để test |

## 4. Token guard cho scene-script — `maxDepth` một mình không đủ

`sceneSnapshot` là tool "start here", gọi nhiều nhất, và **không có guard nào** — vi phạm rule 4 của plan (mọi tool tree/dump phải có token guard). Testbed 5 node/1980 B nên chưa lộ.

Vấn đề thật: `maxDepth` chặn cây **sâu**, không chặn cây **rộng**. Scene slot production hay là 1 root + hàng nghìn con cùng cấp — `maxDepth: 6` cho qua hết.

Thêm `maxNodes` (default 400), cắt theo **số node đã đi**, độc lập với depth:

| Guard | Chặn gì | Node bị cắt báo |
|---|---|---|
| `maxDepth` (6) | cây sâu | `truncated: 'maxDepth'` |
| `maxNodes` (400) | cây rộng | `truncated: 'nodeLimit'` + `childrenOmitted: n` |

`truncated` đổi từ `true` sang **string lý do** — agent biết nên tăng cái nào. Response thêm `nodesVisited` + `budgetExhausted` để phân biệt cây đủ với cây bị cắt.

Budget **chia chung** cho mọi root, không reset mỗi root — nếu reset thì scene 10 root × 400 = 4000 node, guard vô nghĩa.

Cùng lỗ ở 3 chỗ nữa:

| Tool | Trước | Sau |
|---|---|---|
| `nodeQuery tree` | `truncateHierarchy` chỉ chặn depth | nhận `maxNodes`, trả `nodesVisited`/`budgetExhausted` |
| `nodeQuery at_path` | dùng chung `nodeBrief`, không guard | nhận `maxNodes` |
| `componentQuery find` | walk toàn cây, trả mọi match | `maxResults` (200) + `truncated` |
| `componentQuery classes` | trả cả registry ~800 tên | cap 200, `total` vẫn là số thật để agent biết lọc hẹp hơn |

`nodeQuery tree` và `sceneSnapshot` là **2 code path khác nhau** cho cùng một việc: `tree` cắt cây JSON từ `scene:query-hierarchy` ở main process, `sceneSnapshot` walk node `cc.*` trong scene process. Cả 2 giờ cùng quy ước `truncated`/`childrenOmitted` — agent không phải học 2 kiểu.

⚠️ `find-by-component` đổi shape trả về: `[...]` → `{nodes, truncated, maxResults}`. Call site trong `deep-read-tools.ts` đã sửa; `result` ra ngoài vẫn là array nên tool contract không đổi.

## 5. Self-check cho budget — `scripts/check-node-budget.js`

`nodeBrief` giờ có 2 nhánh cắt độc lập, không gì test được vì scene-script chỉ chạy trong scene process. Cách vòng qua: `nodeBrief` là **hàm thuần** trên node object — dựng `cc` giả (chỉ `Object.Flags` / `js.getClassName` / `director.getScene`), `require('dist/scene-script.js')`, gọi handler qua `event.reply` giả.

9 check cho `nodeBrief` (scene-script): cây đủ không có cờ · `maxDepth` cắt đúng · `maxNodes` cắt cây rộng · `childrenOmitted + children.length === childrenCount` · budget cạn không để lại `children: []` rỗng · budget chia chung giữa root · default áp dụng khi thiếu opts · editor node bị filter ở root · `nodesVisited` khớp cây trả về.

3 check cho `truncateHierarchy` (scene-read-tools, code path khác): `maxNodes` cắt cây rộng · `maxDepth` trả lý do dạng string · cây đủ không có cờ. Hàm này phải `export` để test được — nếu ai bỏ export, assert đầu file đỏ chứ không skip im lặng.

**Đã mutation-test cả 2:** thay điều kiện budget thành `if (false)` trong `dist/` → test đỏ đúng chỗ. Không phải test vacuous.

Nối vào `npm run check`; `npm run package` chạy qua `check` nên không package được bản đỏ.

Không cần Creator để chạy — đây là phần logic duy nhất của scene-script verify được offline.

---

# VÒNG 1.2 — 2026-08-08 (phase A+B, không cần Creator)

## 6. `find-by-asset` — chiều ngược asset → node

Surface vòng 1 chỉ đi **một chiều**: node → component → asset ref (`componentQuery props` trả `__ref`). Câu hỏi hay hỏi trước khi sửa asset lại là chiều ngược: *"đổi sprite frame này thì vỡ chỗ nào?"*

Bản 3.x gọi `Editor.Message.request('scene', 'query-node-by-asset')`. **2.4 không có message đó** — nhưng không cần: scene-script có full `cc.*` nên walk tay được. Mọi mảnh đã có sẵn từ vòng 1, không API mới nào:

| Mảnh | Tái dùng từ |
|---|---|
| Walk cây + lọc editor root | `find-by-component` |
| Nhận diện asset ref | `isRefLike()` (dùng cho `component-props`) |
| Path dùng được với `cc.find` | `find-by-component` |
| Cap kết quả | `maxResults` pattern §4 |

Khác `component-props` ở chỗ then chốt: chỗ đó **serialize** giá trị, chỗ này chỉ **so uuid rồi vứt** → rẻ hơn nhiều, không lo circular.

Trả cả `component` + `property` chứ không chỉ node — biết "node X dùng" mà không biết "ở prop nào" thì vẫn phải mò tay. Ref lồng trong array báo kèm index: `frames[1]`.

**Bẫy 6 áp dụng nguyên** (`cc.SpriteFrame.uuid` là getter kế thừa, `_uuid` non-enumerable): so qua `isRefLike()` + fallback `_uuid`, không `Object.keys`.

Nối vào `assetQuery` thành op `used_by` thay vì đẻ tool thứ 10 — tool surface là thứ agent phải giữ trong context, `assetQuery` đã là chỗ hỏi mọi thứ về asset. Giữ **9 tool / 27 op**. Nhận `url` hoặc `uuid` (agent hay cầm url hơn), resolve qua `urlToUuid` sẵn có.

**Giới hạn (ghi rõ, không phải bug):** chỉ quét 2 tầng — prop trực tiếp + phần tử array. Asset lồng trong object-trong-array bị sót, cùng giới hạn với `asRef()` vòng 1. Sub-asset (spriteFrame trong atlas) uuid khác nên **không** match; đúng/sai tuỳ dùng thật.

⚠️ **CHƯA SMOKE trên Creator thật** — 2.4.15 không mở được, chỉ có 5 self-check offline (§8: check thứ 5 thêm sau khi mutation-test lộ 1 check vacuous). Đừng đọc bảng này như đã verify runtime.

## 7. Test harness: constructor giả phải ổn định giữa các lần load

Bug tự gây khi viết check cho `find-by-asset`, đáng ghi vì sẽ tái diễn với bất kỳ check nào dùng `instanceof`:

`loadHandlers()` gán `global.cc = { Asset: function () {} }` — **constructor mới mỗi lần gọi**. Test tạo asset giả *trước* khi gọi handler, nên object mang prototype của lần load trước → `instanceof cc.Asset` trượt, `find-by-asset` trả 0 match. Triệu chứng giống hệt "code sai", thật ra harness sai.

Sửa: khai `FakeAsset`/`FakeNode`/`FakeComponent` ở **module scope**, `loadHandlers` chỉ trỏ tới.

## 8. Mutation-test tìm ra 1 check vacuous

Kỷ luật "mutation-test mọi logic mới" trả tiền ngay. Hai guard `maxResults` trong `find-by-asset`:

| Guard | Chặn gì | Mutation ban đầu |
|---|---|---|
| trong `walk` | nhiều node cùng match | ✅ đỏ |
| trong `scanComponent` | **một** component nhiều prop cùng match | ❌ **vẫn xanh** |

Check `maxResults` đầu tiên của tôi dựng 5 node mỗi node 1 match → guard `walk` chặn trước, guard `scanComponent` không bao giờ chạy. Test xanh, coverage giả.

Thêm check phủ đúng nhánh đó: **1 node, 1 component, 4 prop cùng trỏ asset**, cap 2. Giờ bỏ guard `scanComponent` → đỏ; restore → xanh. 17 check.

Bài học lặp lại vòng 1: *test xanh chưa chắc test có ý nghĩa.* Cả 2 lần đều chỉ lộ ra khi cố tình phá code.

# Phase C — Probe3 + vòng 2 gate (2026-08-20)

**Build:** `f644425-dirty` · **Scene:** `dbQnUq369G5qMjlBnJOvAD` (Scene Grid, helloworld)
**Handler:** `sceneScript('probe3')` — một lượt duy nhất bao 6 nhóm.

## C.1 — kết quả (đối chiếu spec probe)

| # | Spec | Kết quả | Verdict |
|---|---|---|---|
| 1 | `getInstanceById` vs uuid | `hierarchyUuid === _id === "dbQn…"` · `engineSameInstance: true` · `engineType: cc_Node` · `engineName: "Scene Grid"` | ✅ `cc.engine.getInstanceById(uuid)` trả **cùng instance** — `hierarchyUuid` chính là `instanceId`. Không cần `cc.find` nữa |
| 2a | `scene://utils/node` exports | `getObbFromRect, getWorldBounds, getWorldOrientedBounds, getScenePosition, setScenePosition, getWorldPosition, setWorldPosition, getWorldRotation, setWorldRotation, getWorldScale, _hasFlagInComponents, _destroyForUndo, getNodePath, createNodeFromAsset, createNodeFromClass, makeVec3InPrecision, ...` (27 keys) | Chỉ transform + create helpers — **không** có `setProperty` (`probe-undo`/`set-property-by-path` ở module riêng) |
| 2b | `scene://utils/scene` exports | `createDefaultScene, loadScene, loadSceneByUuid, isAnyChildClassOf, copyNodes, pasteNodes, duplicateNodes, moveNodes, hasCopiedComponent, copyComponent, pasteComponent, createNodes, createNodesAt, createNodeByClassID, createNodeByPrefab, deleteNodes, checkAddComponentID, addComponent, checkRemoveComponentID, removeComponent, createProperty, resetProperty, setProperty, copyNodeDataToNodes` (24 keys) | ✅ **High-level write surface** — `createNodes`, `setProperty`, `copyComponent`, `deleteNodes`, `moveNodes`. Đây sẽ là đường write chính vòng 2 |
| 2c | `scene://set-property-by-path` — `setPropertyByPath` | `keys: [setAsset, setPropertyByPath, getPropertyByPath, resetPropertyByPath, setDeepPropertyByPath, fillDefaultValue, setNodePropertyByPath, preprocessForSetProperty]` · `fnLength: 2` · `srcHead: "function(e,t){cc.Node.isNode(e)?d(e,t.path,t.value,t.type):y(e,t.path,t.value,t.type,t.isSubProp)}"` → sig `(nodeOrUuid?, {path,value,type,isSubProp})` — **object form, KHÔNG `(node,path,value)`** | ⚠️ Signature khác suy đoán ban đầu. Tool Batches A/B/HL đoán đúng branch `setter(uuid,path,value)` → throw → fallback `setter(node,path,value)` nhưng object-form chưa từng thử. Vòng 2 cần verify object-form hoặc tiếp tục direct-assign verification path |
| 3 | Undo — `Editor.Undo` vs `_Scene.Undo` vs `scene://undo/index` | `Editor.Undo`: `undo, redo, add, commit, cancel, collapseTo, save, clear, reset, dirty, setCurrentDescription, register, local, Command, _global` · `_Scene.Undo`: `recordObject, recordNode, recordCreateNode, recordDeleteNode, recordMoveNode, recordAddComponent, recordRemoveComponent, commit, cancel, undo, redo, save, dirty, on, reset, init, clear, dump, restore` · `scene://undo/index`: identical to `_Scene.Undo` | `_Scene.Undo` là **low-level recorder** (scene-scoped). `Editor.Undo` là **main-process commit surface**. Write tool đã correct: gọi `scene://set-property-by-path` (đã tự record bên trong) + `Editor.Undo.commit` từ main là đường đúng |
| 4 | `missing-object-reporter` — gate C.2 | `type: function` · `protoKeys: [doReport, report, reportByOwner]` · `stashSrc: "function(e,t,n){var s=this.missingOwners.get(e);s||(s={},this.missingOwners.set(e,s)),s[t]=n}"` · `stashHead: null` | `stashByOwner(owner, prop, serializedAsset)` chỉ ghi vào **internal Map `missingOwners`** — **KHÔNG** gắn property lên `owner[prop]`. Prop đó vẫn `null` ở runtime. Thuật toán vòng 1 (`__qc_bundle__.js:101465`): `depend.owner[depend.prop] = dependAsset.addRef()` chỉ khi CÓ asset, else `stashByOwner` |
| 5 | Introspect 6 msgs (`query-scene-mode`… `query-script-cid`, `query-enum-list-with-path`) | CONTROL `scene:query-hierarchy` → `ok:true` (harness sound). Tất cả 11 còn lại → `err: "ipc failed to send, message not found. panel: scene, message: scene:..."` (thử cả bare và `scene:` prefix, identical) | ❌ **Không tồn tại ở 2.4.15** — chỉ 6 message scene đã verify phase 5 tồn tại. `editorIntrospect` (`8094c9c`) **đóng sổ, không port** |
| 6 | Viewport 6 msgs (icon-gizmo/is2D/grid) | Cùng 11 “not found” trên | ❌ **Không tồn tại ở 2.4.15** — `editorViewport` (`9fc494b`) **đóng sổ, không port** |

Chi tiết thô (full `probe3` output): `scene:utils/node` 27 keys · `scene:utils/scene` 24 keys · `setPropertyByPath` fnLength 2 · `Editor.Undo` 15 keys · Clone `_Scene` (18 keys Undo + 25 keys singleton).

## C.2 — `findNodesWithMissingAssets` — **BỎ**

Cần probe (5) cho thấy `stashByOwner` **không để lại dấu trên object** — prop vẫn `null`,
phân biệt `null` (chưa gán) với `null` (ref gãy) là **không thể** từ scan tĩnh.
Bản đoán “null ⇒ missing” sẽ báo giả 100% trường hợp default-null.

> **Bỏ tool — không đoán** (quy tắc phase C). Ghi lý do: report về asset thiếu sống trong
> `Editor.require('app://editor/page/scene-utils/missing-object-reporter').missingOwners` — internal Map,
> chỉ đọc được ở scene process khi có instance. Không expose ra `Editor.Message`/`Global`.

## C.3 — Quyết định vòng 2 (đường write)

Write train **đã ship** Batches A/B/HL trên `cc-2x` (`6739b20/0b4c2d3/d483520` — `scene-write-tools.ts`, `clipboard-tools.ts`, `animation-tools.ts`, `component-method-tools.ts`, `scene-misc-tools.ts`, `deep-read-tools.ts`, `editor-misc-tools.ts`, `program-tools.ts`):
đúng bài probe3 xác nhận — dải `scene://utils/scene.*` (`createNodes`, `setProperty`, `copyComponent`, `deleteNodes`) + `scene://set-property-by-path` với verify-by-read fallback sang `cur[last]=value` (Batch HL đóng silent-no-op).

**Cửa vòng 2:** `cc.engine.getInstanceById(uuid)` đã **verified cùng-instance** → mọi mutation resolve node thẳng, fallback walk chỉ phòng hờ Electron cũ. `Editor.require('scene://utils/scene')` = high-level façade; `Editor.Undo.commit/add` = history commit. `maxNodes/maxResults` guard copy từ vòng 1.1 giữ nguyên.

**Còn nợ thật 2.4-viable (dịch từ 3.x `custom` 59 tools):** ước ~19 importer + 2 animation read + 1 `propertyArrayElement` — vẫn mở. Tool `build/*` (5) + `editorViewport/introspect` (10/11 probe fail) đóng sổ vĩnh viễn (verified trong C.1).

C.1 ✅ done (probe3 pass) · C.2 ⛔ bỏ có lý do · C.3 ✅ quyết — **gate vòng 2 mở**.


