# Cocos plugin host — delta 2.4.15 vs 3.8.x

Doc 3.x tương ứng: `G:\_ws\_helpers\docs\cocos-plugin-host-architecture.md`. File này **chỉ** ghi phần khác.

Nguồn: corpus `cc_docs` prefix `v2.4/extension/` + verify chạy thật trên 2.4.15 (xem `cocos-2x-api-notes.md`).

---

## Bảng đối chiếu

| Hạng mục | 3.8.x | 2.4.15 |
|---|---|---|
| Manifest | `package_version: 2`, `contributions{}`, `panels{}` (số nhiều) | flat: `main`, `main-menu`, `panel` (số ít), `scene-script`, `reload` |
| Entry export | `export const methods` + `load` + `unload` | `module.exports = { load, unload, messages }` |
| Message decl | `contributions.messages` trong package.json | field `messages` trong entry file |
| Gọi tool nội bộ | `Editor.Message.request(pkg, msg, ...)` → Promise | `Editor.Ipc.sendToMain/sendToPanel(...)` → callback-last |
| Scene access | `Editor.Message.request('scene', ...)` | `Editor.Ipc.sendToPanel('scene', 'scene:...')` **hoặc** `scene-script` (full `cc.*`) |
| Settings | `Editor.Profile.getConfig/setConfig` (async) | `Editor.Profile.load(url, default)` → `.get()`/`.set()`/`.save()` |
| Asset DB | `Editor.Message.request('asset-db', ...)` | `Editor.assetdb.*` — **phần lớn SYNC**, global, không cần require |
| Panel ID | `<pkg>.<panelName>` | `<pkg>` (1 panel, không suffix) hoặc `<pkg>.02` (key `panel.02`) |
| Async idiom | `async/await` xuyên suốt | callback `(err, result)`, timeout arg cuối (default 5000ms, `-1` = tắt) |

Phần **reuse nguyên**, không dính `Editor.*`: `utcp-server.ts`, `decorators.ts`, `schemas.ts`, `config-manager.ts` (trừ Profile).

---

## Process model

```
┌─────────────────── MAIN process ────────────────────┐
│  dist/main.js   module.exports = {load, unload,     │
│                                    messages}         │
│    ├── express server (UTCP)  ← reuse nguyên 3.x    │
│    ├── Editor.assetdb.*       ← SYNC, global        │
│    ├── Editor.Selection.*     ← mutation duy nhat   │
│    ├── Editor.Profile         ← get/set/save        │
│    └── Editor.Scene.callSceneScript(pkg, msg, …, cb)│
└───────────────────────┬─────────────────────────────┘
                        │  IPC — JSON-only
                        ▼
┌────────────── SCENE process ────────────────────────┐
│  dist/scene-script.js   module.exports = {           │
│                            'msg-name'(event, …args) }│
│    ├── cc.*          full engine API                │
│    ├── cc.engine     editingRootNode, getInstanceById│
│    ├── _Scene        Undo, PrefabUtils, SceneUtils   │
│    └── Editor        Ipc, Selection, Undo (subset)   │
│                                                      │
│  reply: event.reply(null, data)                      │
└──────────────────────────────────────────────────────┘
```

⚠️ IPC chỉ qua được **JSON thuần**. `cc.Node` không bao giờ qua được boundary — giống 3.x. Tool truyền `uuid: string`, nhận dump.

⚠️ Scene process **chỉ tồn tại khi có scene đang mở**. Chưa mở scene → `callSceneScript` không có ai nhận.

---

## Hai đường vào scene — chọn cái nào

| Cách | Được gì | Mất gì | Dùng cho |
|---|---|---|---|
| `sendToPanel('scene', 'scene:query-*')` | dump format editor-native (giống Inspector) | chỉ 9 message docs-confirmed | phase 5 — `nodeQuery` |
| `scene-script` + `callSceneScript` | full `cc.*`, tự do traverse | tự viết dump, tự token-guard | phase 6 — `sceneSnapshot`, `componentQuery` |

9 message docs-confirmed (`reference/ipc-reference.md`):
`scene:new-scene`, `scene:play-on-device`, `scene:query-hierarchy`, `scene:query-nodes-by-comp-name`, `scene:query-node`, `scene:query-node-info`, `scene:query-node-functions`, `scene:query-animation-node`, `scene:stash-and-save`

⚠️ `scene:query-node` trả **string**, phải `JSON.parse`. So với 3.8.8 có 191 message — 2.x ít hơn nhiều, nên phase 6 phải tự traverse.

Broadcast nghe được: `scene:ready`, `scene:saved`, `scene:reloading`, `scene:enter-prefab-edit-mode`, `asset-db:assets-created/moved/deleted`, `asset-db:asset-changed`.

---

## Entry point 2.x

```ts
module.exports = {
    async load() { /* start server */ },
    unload() { /* stop server */ },
    messages: {
        // short (không ':') → editor expand thành '<pkg>:restart-server'
        'restart-server'(event, port) { },
        // full (có ':') → nghe broadcast của package khác
        'scene:ready'(event) { },
    }
};
```

Gọi short message từ renderer: `Editor.Ipc.sendToPackage('<pkg>', 'restart-server', port)`.

⚠️ `sendToPackage` **chỉ có ở renderer**. Main process không có — dùng `sendToMain('<pkg>:msg')`.

---

## Profile 2.x — bẫy silent-fail

Docs viết `profile.foo = 'x'; profile.save()`. **Không hoạt động ở 2.4.15** — không throw, không warn, chỉ là không lưu.

`Editor.Profile.load()` trả **EventEmitter có `_chain`**; `save()` serialize state nội bộ, không đọc own-property. Bắt buộc:

```ts
const profile = Editor.Profile.load(`profile://project/${PKG}.json`, {
    serverPort: 0, utcpConfigPath: '',
});
profile.set('serverPort', 59142);
profile.save();
const port = profile.get('serverPort');
```

File ghi ra `<project>/settings/<pkg>.json`. **Không cần `Editor.Profile.register()`** — editor register sẵn type `project`.

Chi tiết + dump probe: `cocos-2x-api-notes.md`.

---

## Build scope

`tsconfig.exclude` **không** chặn transitive import — phải exclude cả file trung gian:

```
source/utcp/tools                    13 tool file dùng Editor.Message (3.x)
source/utcp/utils/asset-importers    19 importer, .meta 3.x
source/utcp/utils/tools-utils.ts     import asset-importers → kéo cả 19 file vào
source/panels                        Editor.Panel.define + Editor.Message (3.x)
source/scene.ts                      contributions.scene của 3.x
```

**KHÔNG `git rm`** — cần đọc lại khi port vòng 2.

Build ra 7 file: `main.js`, `scene-script.js`, `utcp/{config-manager,decorators,schemas,utcp-server}.js`, `utcp/utils/texture-utils.js`.

---

## Typings

Không có `.d.ts` chính thức cho 2.x. `@cocos/creator-types@3.8.7` đã bỏ — mô tả **sai** runtime 2.4.15.

`@types/editor-2x/index.d.ts` viết tay từ docs, mỗi namespace có comment nguồn. `typeRoots` khai ở **cả** `tsconfig.json` và `base.tsconfig.json` (file sau ghi đè nếu chỉ sửa 1).

⚠️ `delete` và `import` là reserved word trong TS namespace → không khai được trong `namespace assetdb`. Call site vòng 2: `(Editor.assetdb as any)['delete'](urls, cb)`.

`cc` để `any` — Creator ship `resources/engine/api.d.ts` nhưng cũng chỉ khai `declare let cc: {[x:string]: any}`.

⚠️ `resources/app.asar` chứa `editor-framework/` + `asset-db/` nhưng file `.ccc` **mã hoá** → không dùng làm nguồn API. Ngoại lệ: `resources/builtin/*` là plain JS, dùng được làm ví dụ manifest thật.

---

## Câu hỏi chưa giải quyết

1. `Editor.assetdb` có thật sự sẵn global trong main.js plugin? (phase 4 trả lời ngay)
2. Vòng 2: resolve node-by-uuid trong scene process — `cc.engine.getInstanceById(uuid)` là ứng viên, chưa verify
3. Vòng 2: undo dùng `Editor.Undo.add + commit` hay `_Scene.Undo`?


---

## Rename 2026-08-21 -- cocos-code-mode-2x -> cc-remoter-2x

- Extension ID + npm package.json name: cc-remoter-2x (panel CC Remoter 2x). Re-import extension after rename (Creator caches package name).
- PROFILE_URL = profile://project/cc-remoter-2x.json -> file <project>/settings/cc-remoter-2x.json. config-manager.ts#getProfile auto-migrates legacy cocos-code-mode-2x.json if new file empty.
- Scene pkg for Editor.Scene.callSceneScript(pkg, ...) + Editor.Ipc.sendToPackage -> cc-remoter-2x (all source/*, panel/*, scene-script handlers).
- UTCP manuals: long cc-remoter-2x (JS cc_remoter_2x) + short ccr-2x->ccr_2x -- SDK name.replace(/[^\w]/g,"_") so hyphen in ~/.utcp_config.json normalizes to underscore when calling: cc_remoter_2x.sceneSnapshot(...) / ccr_2x.*. Legacy cc2x4/cc-remoter-v2x4 auto-migrated in config-manager + cc-remoter-bootstrap.js (+ cc-remoter-cache.json mapping).
- cc-remoter-2x.d.ts is canon agent-facing (legacy code-mode-references-2x.d.ts shim kept). README Quickstart + Agent prompt + UTCP Call Templates synced.
- Compat shims: scripts/code-mode-bootstrap.js -> shim to scripts/cc-remoter-bootstrap.js; .claude/skills/cc-code-mode deprecated -> cc-remoter-2x; .claude/settings.json hook points to cc-remoter-bootstrap.js.
