# Probe guide — gỡ chặn write train (vòng 2)

Làm khi **Creator 2.4.15 đang chạy** với project `cc-2x-testbed` đã cài extension `cc-bridge-2x`.

Mục đích: trả lời 3 câu hỏi chặn mọi write tool, rồi port write train.

## Chuẩn bị

```powershell
# 1. Build mới nhất (đã có probe handlers)
npm run build

# 2. Mở Creator 2.4.15
Start-Process "C:\ProgramData\cocos\editors\Creator\2.4.15\CocosCreator.exe" -ArgumentList '--path','G:\_ws\_helpers\cc-2x-testbed'

# 3. Đợi Editor log: [cc-bridge-2x] UTCP Server started on port 5xxxx
# 4. Lấy port
cat G:\_ws\_helpers\cc-2x-testbed\settings\cc-bridge-2x.json  # legacy cocos-code-mode-2x.json also checked
```

## Probe 1: `cc.engine.getInstanceById(uuid)` nhận uuid gì?

**Vì sao chặn:** Mọi write theo uuid phải resolve node trong scene process. Ứng viên `cc.engine.getInstanceById` đã có 3 call site trong engine (`CCWidgetManager.js:274,287,313`) nhưng chưa biết `id` có bằng `uuid` từ `scene:query-hierarchy` không.

**Chạy:**

```js
// curl hoặc Extension -> Developer -> Console (renderer devtools)
// Thay <port> và <node-uuid> (lấy từ sceneSnapshot)
const uuid = "a286bbGknJLZpRpxROV6M94"; // Canvas, lấy từ scene:query-hierarchy
// Gọi sceneScript probe đã có sẵn — thêm handler tạm nếu cần
```

Thêm vào `source/scene-script.ts` trong `module.exports = { ... }`:

```js
'probe-getInstanceById': function (event, uuid) {
    try {
        const byEngine = cc.engine.getInstanceById(uuid);
        const byFind = cc.find('Canvas'); // control
        event.reply(null, {
            uuid,
            engineFound: !!byEngine,
            engineName: byEngine && byEngine.name,
            findWorksForComparison: !!byFind,
            // thử _Scene hoặc cc.director
            sceneChildren: cc.director.getScene().children.map(c => ({ name: c.name, uuid: c.uuid })),
        });
    } catch (e) { event.reply(e); }
},
```

Build → restart Creator → gọi:

```
GET http://localhost:<port>/tools/scene-script?message=probe-getInstanceById&uuid=<canvas-uuid>
```

Hoặc từ `cc_bridge_2x` code-mode (manual `cc-bridge-2x`, short `ccb2x` (compat `ccb-2x`/`ccb_2x`)):

```js
cc_bridge_2x.sceneScript('probe-getInstanceById', 'a286bbGkn...')
```

**Kết quả mong đợi:**
- `engineFound: true, engineName: "Canvas"` → id == uuid, dùng được → **unblock node-by-uuid**
- `false` → thử `Editor.Selection` uuid hoặc sceneIPC uuid, hoặc phải walk + match uuid như `find-by-component`

---

## Probe 2: `Editor.require('scene://utils/node')` export gì?

**Vì sao chặn:** 2.4 engine dùng `scene://utils/node`, `scene://utils/prefab` etc. (thấy trong engine source). `.ccc` mã hoá không đọc được, chỉ biết tên module. Nếu require được thì gọi thẳng API tạo/sửa node thay vì guess message.

**Chạy:**

Thêm handler:

```js
'probe-scene-utils': function (event) {
    const out = {};
    function tryRequire(url) {
        try { return Object.keys(Editor.require(url)); }
        catch (e) { return 'ERR: ' + e.message; }
    }
    out['scene://utils/node'] = tryRequire('scene://utils/node');
    out['scene://utils/prefab'] = tryRequire('scene://utils/prefab');
    out['scene://utils/scene'] = tryRequire('scene://utils/scene');
    out['scene://utils/animation'] = tryRequire('scene://utils/animation');
    out['scene://edit-mode'] = tryRequire('scene://edit-mode');
    // also try full path
    out['app://editor/page/scene-utils/utils/node'] = tryRequire('app://editor/page/scene-utils/utils/node');
    event.reply(null, out);
},
```

```js
cc_bridge_2x.sceneScript('probe-scene-utils')
```

**Kết quả mong đợi:** Mỗi entry trả array tên export (ví dụ `['createNode','removeNode','setProperty',...]`). Dựa vào đó chọn API cho write.

---

## Probe 3: `set-property-by-path` nhận path dạng nào? + undo API

**Vì sao chặn:** Sửa property (`node.x = 100`, `sprite.spriteFrame = uuid`) và undo là core của write train.

**Chạy:**

Thêm handler:

```js
'probe-set-prop': function (event, path, value) {
    // path ví dụ: "x", "position.x", "scale"
    // value: 100 hoặc {x:1,y:2}
    const out = { errors: [] };
    function tryIt(label, fn) {
        try { out[label] = fn(); }
        catch (e) { out.errors.push(label + ': ' + e.message); }
    }
    // set-property-by-path có trong scene-utils: Editor.require('scene://...')?
    tryIt('has_setPropertyByPath', () => {
        // file scene-utils/set-property-by-path.ccc đã thấy listing
        const mod = Editor.require('scene://utils/node');
        return typeof mod.setProperty === 'function' || typeof mod.setPropertyByPath === 'function';
    });
    // undo API
    tryIt('Editor.Undo', () => Object.keys(Editor.Undo || {}).slice(0,20));
    tryIt('_Scene.Undo', () => typeof _Scene !== 'undefined' ? Object.keys(_Scene.Undo || {}).slice(0,20) : 'no _Scene');
    // thử set thật trên 1 node
    if (path) {
        try {
            const node = cc.find('Canvas/background'); // node có sẵn
            // thử các API có thể
            if (Editor.require) {
                const utils = Editor.require('scene://utils/node');
                if (utils.setProperty) {
                    utils.setProperty(node.uuid, path, value);
                    out.setViaUtils = 'ok';
                }
            }
        } catch (e) { out.setError = e.message; }
    }
    event.reply(null, out);
},
```

```js
cc_bridge_2x.sceneScript('probe-set-prop', 'x', 999)
cc_bridge_2x.sceneScript('probe-set-prop') // dump API trước
```

**Kết quả mong đợi:**
- Biết path format (`x` vs `position.x` vs `_position.x`)
- Biết undo entry point (`Editor.Undo.commit`, `_Scene.Undo`, `Editor.Ipc.sendToPanel('scene','scene:undo')` etc.)
- Biết saveMeta path (`Editor.assetdb.saveMeta` vs `saveExists`)

---

## Sau khi probe xong

1. Ghi kết quả vào `docs/cocos-2x-api-notes.md` § vòng 2 (giống cách đã ghi 6 bẫy trước)
2. Dựa vào đó port write train theo thứ tự:
   - `nodeCreate` / `nodeOperate` (move/delete/duplicate/parent)
   - `nodeComponentAdd` / `Remove`
   - `setProperties` (node + component)
   - `assetCreate` / `assetOperate` (move/delete/copy)
   - `undo` / `redo` wrapper
3. Mỗi nhóm thêm check vào `scripts/check-node-budget.js` hoặc file check riêng, mutation-test như vòng 1

## Lưu ý

- Sau mỗi `npm run build` phải restart Editor (junction không auto-reload)
- `npm run check` phải pass trước khi commit
- KHÔNG đoán API — chưa verify thì để Unresolved, không code
