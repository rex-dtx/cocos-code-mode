# 3.7.3 API drift — kết quả điều tra

Nguồn: registry `builtin/*/package.json` + i18n `doc:` block của **chính bản 3.7.3**
(`G:\_ws\app.asar.unpacked`, version 3.7.3), đối chiếu typed `@cocos/creator-types@3.8.7`.

Dump đầy đủ: `cc-3x7-message-registry.json` (20 module, 416 message, 60 có param spec).
Regenerate: `python G:\_ws\_helpers\extract-module-messages.py --json <out.json> <module...>`

⚠️ **npm không có `@cocos/creator-types` < 3.8.0** (`dist-tags.latest = 3.8.7`, danh sách versions
bắt đầu từ 3.8.x). Nên typed `.d.ts` đang dùng **mô tả 3.8.7, không phải 3.7.3** — mọi type ở đó
là giả định cho tới khi verify. Handler `.ccc` mã hoá, không đọc được. i18n `doc:` block là
nguồn signature machine-readable duy nhất cho 3.7.x.

---

## Coverage: 112/117 message dùng bởi 59 tool CÓ ở 3.7.3

| Module | Dùng | Có ở 3.7.3 | Thiếu |
|---|---|---|---|
| scene | 84 | 83 | 1 |
| asset-db | 20 | 19 | 1 |
| builder | 5 | 5 | 0 |
| program | 3 | 1 | 2 |
| preview | 2 | 2 | 0 |
| project | 2 | 1 | 1 |
| engine | 1 | 1 | 0 |

Tin tốt: phần lớn tool surface dùng được. Vấn đề nằm ở **signature**, không phải message vắng mặt.

---

## 1. Signature drift — nguy hiểm nhất (fail im lặng hoặc `parameter error`)

Đã xác nhận từ i18n doc 3.7.3:

| Message | 3.7.3 | 3.8.x (code đang theo) | Hệ quả |
|---|---|---|---|
| `asset-db/query-assets` | `pattern?` **{string}** | `options?` **{QueryAssetsOption}** | ❗ `parameter error` code -1 |
| `asset-db/query-asset-info` | `urlOrUUID` | `urlOrUUIDOrPath` | path không resolve được |
| `asset-db/query-uuid` | `url` (chỉ url) | `string` (url\|path) | path không resolve được |

**`query-assets` chính là bug `assetGetTree` a báo** — stack trỏ `query.ccc:1:5648`, do
`asset-tools.ts` truyền `{pattern}` object mà 3.7.3 mong string.

Fix đã có ở branch `custom` commit `ec50962` (`queryAssetsCompat`: try object → catch → string,
kèm re-filter client-side vì fallback làm mất ccType/importer/extname/isBundle).

⚠️ **Chỉ 60/416 message có param doc** → 356 message còn lại signature vẫn là ẩn số. Không thể
kết luận "chỉ 3 cái drift" — chỉ có thể nói "3 cái drift trong số đã kiểm chứng được".

## 2. Message vắng mặt hẳn ở 3.7.3 (5) — ✅ ĐÃ XỬ LÝ HẾT

Cả 4 cái còn lại đã **verify runtime** trên Creator 3.7.3 thật (project
`cc-fws\cc30-new-all-in-one`, 2026-08-06) rồi mới sửa — không suy đoán từ registry.

| Module | Message | Tool ảnh hưởng | Trạng thái |
|---|---|---|---|
| `asset-db` | `query-asset-thumbnail` | `assetGetPreview` (mesh/gltf branch) | ⏳ Chưa verify được — server live lúc test còn chạy build cũ (không có `/build-info`). Đã có fallback renderer-based ngay dưới nhánh này |
| `program` | `open-program` | `programOpen` | ✅ **FIX** `4832cf1` — map sang `execute`. Doc block 3.7.3 khai đúng 2 param `program {string}` + `args {Record<string,any>}` → match có tài liệu, không phải đoán |
| `program` | `open-url` | `urlOpen` | ✅ **FIX** `4832cf1` — fallback `execFile` (không `exec`, không shell), chặn scheme ngoài http(s) vì URL thành command argument |
| `project` | `set-config` | `projectSetConfig` | ✅ **FIX** `4832cf1` — **KHÔNG map**. Báo unsupported + chỉ workaround. Xem lý do dưới |
| `scene` | `query-uuid` | `nodeOperate` (sibling index) | ✅ **ĐÃ FIX** — xem §2b |

**Lỗi runtime thật đã ghi nhận** (trước khi fix):
```
Message does not exist: program - open-url
Message does not exist: program - open-program
Message does not exist: project - set-config
```

**Vì sao KHÔNG map `project/set-config`:** 3.7.3 có `change-script-config` / `import-config` /
`export-config`, nhưng **không cái nào ghi một dotted path đơn lẻ** — cái đầu chỉ đụng script
settings, hai cái sau chuyển cả file. Map bừa = ghi sai key **im lặng**, nguy hiểm hơn là báo lỗi.
Nguyên tắc đã chốt: **bỏ tool > map sai**. Đọc vẫn OK (`projectGetConfig` verify chạy tốt).

## 2b. `scene/query-uuid` — bug sẵn có, KHÔNG phải drift

Message này **không tồn tại ở cả 3.7.3 lẫn 3.8.7** (grep typed `scene/@types/message.d.ts` = 0 hit).
Nó nằm ở nhánh fallback của `SceneTools.getParent` — tức mọi lần node không có `parent` ghi nhận
(node nằm thẳng dưới scene root) thì hàm này **luôn throw**, trên mọi version. Không ai phát hiện
vì nhánh đó hiếm khi chạy.

Fix: dùng `scene/query-current-scene` (có ở 3.7.3, và chính file này đã dùng ở `scene-tools.ts:58`).
Shape đa dạng theo version — string uuid hoặc object `{uuid,url,name}` — xử lý cả hai.

Ảnh hưởng: `getParent` → `setSiblingIndex` + `getParentAndSiblingIndex` → `nodeOperate`.

---

## 3. Việc tiếp theo

1. **Runtime test trên 3.7.3** (`G:\_ws\AI_CC_Test`, đang cài bản 24-tool cũ 18/06) — smoke 61 tool,
   ghi pass/fail + shape thật. Đây là gate quyết định phạm vi sửa, không đoán tiếp được nữa.
2. Xử lý 5 message thiếu: bỏ tool hay map thay thế (cần kết quả bước 1).
3. Cân nhắc viết `@types/editor-3x7.d.ts` tay từ registry — nhưng **chỉ sau** khi runtime test cho
   biết thực sự lệch bao nhiêu. Viết trước = đoán, giống lỗi rev 1 của bản 2x.

---

## 4. Khảo sát message chưa wrap (2026-08-06) → +2 tool, +1 operation

Quét toàn bộ 416 message, trừ 117 message đã dùng:
- **20 public** chưa wrap — phần lớn là broadcast (`asset-db:ready`, `scene:close`…) và UI panel
  (`open-settings`, `open-devtools`)
- **238 non-public, non-broadcast** chưa wrap

Đã thêm (đều read-only, verify có ở registry 3.7.3, signature từ facade):

| Tool / op | Message | Nguồn signature |
|---|---|---|
| `materialQuery` (5 op) | `scene/query-all-effects`, `query-effect`, `query-material`, `query-serialized-material`, `query-render-pipeline` | facade `general-scene-facade.d.ts:139-142` |
| `assetDbQuery` (4 op) | `asset-db/query-db-list`, `is-busy`, `query-asset-mtime`, `query-asset-data` | registry (không typed, không facade) |
| `editorIntrospect` +`has_script` | `scene/query-component-has-script` | typed **+** facade `:76` — hiếm, có cả hai |

**Giá trị nổi bật:** `assetDbQuery busy` cho biết db có đang import dở không — mảnh còn thiếu khi
asset query ngay sau `refresh` trả kết quả cũ. `has_script` chặn typo class name trước khi
`addComponent`/`callComponentMethod` nổ runtime.

### Đã cân nhắc và BỎ (ghi lại để khỏi quét lại)

| Ứng viên | Lý do bỏ |
|---|---|
| `project/query-design-resolution` | Trùng — `projectGetConfig` đã đọc được qua `general.designResolution` |
| `scene/apply-removed-component`, `revert-removed-component` | **Không có facade, không typed** → không có signature đáng tin. Nguyên tắc: không đoán API |
| `scene/set-node-and-children-layer` | Facade nhận `SetPropertyOptions` nhưng không tìm thấy định nghĩa interface đó |
| `scene/getdata-prefab`, `unlink-prefab`, `apply-prefab` | `nodeOperate` đã bao create/link/revert/apply/unwrap/open |
| `messages/*`, `shortcuts/*`, `preferences/*` | Panel-bound / IDE UI, agent không dùng |
| `preview/*` (11 msg) | Panel-bound; `previewGetUrl`/`previewOpenInBrowser` đã đủ |
| `scene/quit-editor`, `unit-test`, `native-*` | Nguy hiểm hoặc internal |
| `builder/*` (29 msg) | Build pipeline đã có 5 tool; còn lại là worker-internal |
| `animator` (24), `animation-graph` (8) | Panel-bound, cần UI state. Animation **editing** ở module `scene` đã wrap ở b8 |

**Kết luận: tool surface đã bão hoà.** Còn ~230 message nhưng gần như toàn bộ là panel-bound,
internal, hoặc trùng chức năng. Batch sau nên chờ feedback runtime, đừng quét registry tiếp.

## Unresolved

1. 356/416 message không có param doc → signature ẩn số. Chiến lược: compat helper try-catch như
   `queryAssetsCompat`, hay probe từng cái khi runtime test?
2. `project/set-config` 3.7.3 map sang gì? `change-script-config` chỉ đổi script config hay cả
   project config?
3. `sharp 0.30.7` + `express 4` pin cho 3.7.x đã đúng chưa — chưa verify Electron version của 3.7.3.
4. `scene/query-uuid` là bug sẵn có tồn tại trên cả 3.8.x — nên port fix ngược về branch `custom`
   không, hay để `custom` tự xử khi quay lại 3.8.x?
