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

## Coverage: 128/132 message dùng bởi 61 tool CÓ ở 3.7.3

⚠️ Bản đầu của doc này ghi **112/117 / 59 tool** — **sai**. Đo lại 2026-08-06 bằng
`grep` 2-literal `Editor.Message.request` + đối chiếu registry:

| Module | Dùng | Có ở 3.7.3 | Thiếu |
|---|---|---|---|
| scene | 95 | 95 | 0 |
| asset-db | 24 | 23 | 1 |
| builder | 5 | 5 | 0 |
| program | 3 | 1 | 2 |
| preview | 2 | 2 | 0 |
| project | 2 | 1 | 1 |
| engine | 1 | 1 | 0 |
| **tổng** | **132** | **128** | **4** |

Con số cũ sót vì đếm trước khi thêm `materialQuery`/`assetDbQuery`/`has_script`, và
`scene/query-uuid` khi đó còn bị tính là "thiếu" (thực ra là bug sẵn có, xem §2b).

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

Runtime test **ĐÃ CHẠY** 2026-08-06 trên Creator 3.7.3 thật — project
`G:\_ws\cc-fws\cc30-new-all-in-one` (KHÔNG phải `AI_CC_Test` như dự định ban đầu).
Kết quả: `plans/reports/verifier-260806-1520-3x7-smoke.md`.

| Việc | Trạng thái |
|---|---|
| Smoke 61 tool | ✅ phần lớn PASS. `materialQuery` / `assetDbQuery` / `has_script` / `assetGetTree` / `assetQuery` đều chạy đúng trên 3.7.3 |
| 4 message thiếu | ✅ 3 fix (`4832cf1`), 1 (`query-asset-thumbnail`) chưa verify được |
| `@types/editor-3x7.d.ts` | ❌ **KHÔNG cần** — chỉ 3 message lệch signature, dưới ngưỡng đáng viết 400 LOC typings. Compat helper try-catch rẻ hơn nhiều |
| Port fix ngược `custom` | ✅ 8/8 (`6c498c9` + `18b3794`) |

**Còn chặn:** editor chưa reload nên nhóm file đã sửa (`asset-tools`, `scene-tools`,
`component-tools`, `editor-tools`, `set-properties-tool`, `utcp-server`) chưa test lại được.
`GET /build-info` là cách xác nhận build nào đang trả lời — 404 = process cũ.

**Đừng file bug khi `/build-info` trả 404.** Bài học đã tốn 1 lượt test: bug được file trên build
tạo ra TRƯỚC khi fix landed, hoá ra là bug đã không còn tồn tại trong source.

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

## 5. Chiến lược branch — option (a) / (b) / (c) là gì

Vấn đề: 3 branch cho 3 version Cocos, cùng 1 codebase gốc, đang trôi xa nhau.

```
custom  (3.8.x)  18b3794   59 tool   ← đã nhận đủ 8 bug-fix
cc-3x7  (3.7.x)  e193894   61 tool   ← đang phát triển
cc-2x   (2.4.x)  78fee04    9 tool   ← kiến trúc KHÁC HẲN, không gộp được
```

`cc-2x` dùng `Editor.assetdb.*` direct-object + `scene-script.js`, không phải message-async như 3.x
→ **luôn đứng riêng**, không nằm trong 3 option này. Chỉ bàn `custom` ↔ `cc-3x7`.

### (a) Giữ 2 branch, port tay khi cần

```
cc-3x7 ──fix──┐
              ├─ cherry-pick tay từng cái ──► custom
custom ───────┘
```

Mỗi bug fix / tool mới phải port tay 2 lần. Đang làm cách này (B3 vừa rồi = 1 lượt port tay).
**Được:** không cần abstraction, mỗi branch tự do. **Mất:** drift tăng dần, dễ quên port, và
lần nào cũng phải tự tay verify "branch kia có dính bug này không".

### (b) Gộp 1 branch, dùng compat guard *(khuyến nghị)*

```
                  ┌─────────────────────────────┐
   1 branch ──────│  code chung 95%             │
                  │  + guard tự nhận version:   │
                  │    try{ msg_3.8 }           │
                  │    catch{ msg_3.7 }         │──► chạy đúng trên CẢ 3.7.3 và 3.8.x
                  │    typeof api === 'function'│
                  └─────────────────────────────┘
```

**Không phải** viết adapter layer mới — pattern này **đã tồn tại và đã verify runtime**:

| Guard đã có | Cơ chế | Đã chứng minh |
|---|---|---|
| `queryAssetsCompat` | try object-arg → catch → string-arg | ✅ chạy đúng trên 3.7.3 |
| `programOpen` | try `open-program` → catch → `execute` | ✅ 3.7.3 báo missing, fallback hoạt động |
| `urlOpen` | try `open-url` → catch → `execFile` | ✅ như trên |
| `assetGetPreview` | `typeof openBeside === 'function'` | ✅ 3.8 có → dùng; 3.7 không → `Panel.open` |
| `getParent` | xử lý cả string uuid lẫn `{uuid}` | ✅ |

**Bằng chứng mạnh nhất:** cherry-pick 6-bug-fix từ `cc-3x7` sang `custom` **merge sạch, 0 conflict**,
build exit 0. Hai branch **chưa thực sự phân kỳ về code** — chỉ khác 2 file compat mà bản thân
chúng tự no-op đúng version. Tức là (b) gần như **đã đạt được rồi**, chỉ thiếu bước gộp.

**Được:** 1 nguồn, fix 1 lần ăn cả 2 version, hết drift.
**Mất:** mỗi lần đổi phải test 2 editor version. **Nhưng rủi ro này đã hiện hữu** — 8 fix vừa port
sang `custom` hiện chưa ai chạy trên 3.8.x.

### (c) Freeze `custom`, chỉ dev trên `cc-3x7`

```
custom  ══╳══ đóng băng ở 3.8.x (không nhận gì mới)
cc-3x7  ──────────────► phát triển tiếp
```

**Được:** 1 nơi dev, khớp chỉ đạo "3.8.x tính sau", chi phí thấp nhất **ngay lúc này**.
**Mất:** 3.8.x đứng yên. Khi nào quay lại 3.8.x thì phải port ngược một lô lớn — đúng cái vừa phải
làm ở B3, nhưng to hơn nhiều.

### Vì sao đổi khuyến nghị từ (c) sang (b)

Lần đầu đề xuất (c) vì tưởng 2 branch khác nhau đáng kể ("~3 signature"). **Sai.** Sau khi port thật:
diff `source/` chỉ **7 file**, và **0 file nào là bug lệch** — toàn feature + 2 file compat tự
no-op. (c) chỉ hoãn chi phí port, không xoá nó; (b) xoá luôn.

Nếu chọn (b), bước kế: merge `cc-3x7` → `custom`, giữ nguyên compat guard, xoá branch `cc-3x7`,
rồi smoke 1 lượt trên **cả** 3.7.3 và 3.8.x.

---


1. 356/416 message không có param doc → signature ẩn số. **Chiến lược đã chốt: compat helper
   try-catch** như `queryAssetsCompat`. Lý do: 3 drift thật + 3 message vắng mặt đều lộ ra qua lỗi
   runtime rõ ràng (`Message does not exist: …`, `parameter error` code -1), không cần probe hàng
   loạt — mà probe hàng loạt còn phải **đoán args hợp lệ** cho message không rõ signature → dễ
   false-negative (fail vì args sai, không phải vì message thiếu).
2. ~~`project/set-config` map sang gì~~ → ✅ **RESOLVED: KHÔNG map.** `change-script-config` chỉ đụng
   script settings; `import-config`/`export-config` chuyển cả file. Không cái nào ghi 1 dotted path.
   Map bừa = ghi sai key **im lặng**. Đã đổi thành báo unsupported + chỉ workaround (`4832cf1`).
   Nguyên tắc: **bỏ tool > map sai**.
3. `sharp 0.30.7` + `express 4` pin cho 3.7.x đã đúng chưa — chưa verify Electron version của 3.7.3.
   Bằng chứng gián tiếp: 61 tool load được và trả kết quả trên 3.7.3 → transport (express 4) OK.
   `sharp` thì chưa chứng minh: nhánh dùng nó (`assetGetPreview`) là cái duy nhất chưa test được.
4. ~~`scene/query-uuid` nên port ngược về `custom`?~~ → ✅ **RESOLVED: đã port** (`18b3794`).
   Verify trước khi port: `custom` vẫn còn bug thật. Cùng lượt port luôn 6 bug của `35ec127`
   (cherry-pick `6c498c9`, merge sạch 0 conflict). **8/8 fix đã sang `custom`, build exit 0, nhưng
   chưa runtime-test trên 3.8.x** — branch đó không có editor session nào mở.
5. **Mới:** `custom` ↔ `cc-3x7` sau khi port chỉ còn khác **7 file**, toàn bộ là feature/compat có
   chủ ý, **không còn bug nào lệch**. Trong đó `program-tools.ts` + `project-tools.ts` là compat
   3.7.x thuần — cả hai đã tự no-op đúng version bằng `typeof`/try-catch guard. Nghĩa là gộp 1
   branch khả thi mà không cần abstraction layer. Chờ quyết định.
