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
| `assetQuery` | search · tree · info · meta · types · sub_assets | `assetdb` sync + `queryAssets`/`deepQuery` async + `fs` (.meta) |
| `assetReadContent` | — | `assetdb` → `fs.readFileSync` |
| `nodeQuery` | tree · dump · info · functions · by_component · at_path | scene panel IPC (5) + scene-script (at_path) |
| `sceneSnapshot` | — | scene-script `cc.*` traverse |
| `componentQuery` | props · classes · by_name · find | scene-script (3) + scene panel IPC (by_name) |
| `editorSelect` | query · select · unselect · clear | `Editor.Selection.*` |
| `editorEnvInfo` | — | `Editor.versions` + `Editor.Project.path` + `process.versions` |
| `projectGetConfig` | — | `fs` đọc `<project>/settings/*.json` |

**9 tool, 26 op.** Mutation duy nhất: `editorSelect` (selection, không phải scene).

## Bỏ khỏi vòng 1

| Tool | Lý do |
|---|---|
| `editorGetLogs` | 2.4.15 không có API đọc console — verified 3/3 message fail |
| 14 tool 3.x (`source/utcp/tools/`) | dùng `Editor.Message.request`, không tồn tại ở 2.x — port vòng 2 |
| 19 asset importer | `.meta` format 3.x — port vòng 2 |

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
8. `scene:query-node` `types` 12 class def cho 1 node (~19 KB) — có cách xin dump không kèm `types`?
9. `sceneSnapshot` trên scene production của team (testbed chỉ 5 node / 1980 B). > 50 KB thì hạ default `maxDepth` xuống 4.
10. `find-by-component` node trùng tên → path không unique. Cần index `Canvas/Bg[1]`? YAGNI tới khi gặp.
11. Config panel UI chưa port — vòng 1 server tự start, đọc port ở `settings/cocos-code-mode.json`.

---

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

## Unresolved bổ sung

12. `cc.engine.getInstanceById(id)` — `id` có bằng `uuid` từ `scene:query-hierarchy` không? (probe vòng 2)
13. `Editor.require('scene://utils/node')` export gì? Probe `Object.keys` trước khi code.
14. `set-property-by-path` nhận path dạng nào? Ứng viên chính cho write property.

