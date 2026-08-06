# Smoke test 3.7.3 — kết quả runtime thật

**Ngày:** 2026-08-06 15:20 · **Editor:** Cocos Creator **3.7.3**
**Project:** `G:\_ws\cc-fws\cc30-new-all-in-one` (KHÔNG phải `AI_CC_Test` như plan đoán)
**Server:** `http://localhost:57025` · 61 tool trong `/utcp`
**Branch:** `cc-3x7`

---

## ⚠️ Đọc trước: build nào đang chạy?

Server live **không có** `/build-info` → nó là process **cũ hơn commit `55660ce`**.
`dist/` trên đĩa đã là `4832cf1` nhưng editor chưa reload.

Hệ quả: kết quả chia làm 2 loại, không được trộn.

```
git diff --name-only bbe0806..d21acbd -- source/
├── ĐÃ SỬA sau khi build đang chạy được tạo → kết quả KHÔNG đáng tin
│   asset-tools · component-tools · editor-tools · scene-tools
│   set-properties-tool · utcp-server · main · scene · build-info
└── KHÔNG ĐỘNG → kết quả từ build cũ VẪN ĐÚNG
    animation-tools · build-tools · get-properties-tool · material-tools
    preview-tools · program-tools · project-tools · property-array-tools
    typescript-defenition
```

Đây chính là bẫy `55660ce` cảnh báo: file bug trên build cũ hơn fix. Không lặp lại.

---

## A · Tool tôi viết mà chưa từng chạy — PASS hết

| Tool / op | Kết quả thật |
|---|---|
| `assetDbQuery busy` | `{"result":false}` |
| `assetDbQuery databases` | `{"result":["internal","assets"]}` |
| `assetDbQuery mtime` (thiếu arg) | báo lỗi đúng, không crash |
| `materialQuery effects` | record keyed by effect name → `{uuid,name,hideInEditor}` |
| `materialQuery effect` | array pass → `props[]` có `name/value/default/type/readonly/visible` |
| `editorIntrospect has_script` `cc.Sprite` | `{"hasScript":true}` |
| `editorIntrospect has_script` bogus | `{"hasScript":false}` — chặn typo đúng như thiết kế |

**Shape đã biết** (trước đây là ẩn số vì facade type `Promise<any>`):
- `query-all-effects` → **record**, key = effect name, KHÔNG phải array
- `query-effect` → **array** pass, mỗi pass có `props[]`
- `query-db-list` → array string đơn giản

## B · Fix drift — bug anh báo đã hết

| Tool | Kết quả |
|---|---|
| `assetGetTree` | cây đúng, có `filesystemPath` + `reference` + `children` lồng nhau |
| `assetQuery` `pattern`+`ccType` | filter đúng, trả `cc.SceneAsset` kèm `uuid/name/url/type/importer/isDirectory` |

`queryAssetsCompat` (try object → catch → string + re-filter client-side) **chạy đúng trên 3.7.3 thật**.

## C · 3 message thiếu — confirmed chết, đã fix

Lỗi runtime nguyên văn:
```
Message does not exist: program - open-url
Message does not exist: program - open-program
Message does not exist: project - set-config
```

Fix ở `4832cf1`, doc verdict ở `5372375` — xem `docs/cocos-3x7-api-drift.md` §2.

## D · File không bị session khác động — PASS

| Tool | Kết quả |
|---|---|
| `buildGetTasksInfo` | `{"workerReady":true,"free":true,"tasks":[]}` |
| `previewGetUrl` | `{"url":"http://192.168.20.100:7456"}` |
| `programGetInfo` (tên không tồn tại) | báo lỗi rõ ràng, đúng ý đồ |
| `animationQuery root_info` | `{root, nodeTreeDump{name,active,locked,type,uuid,children[]}}` |
| `animationQuery root` | uuid string |
| `projectGetConfig` | đọc được `general.designResolution` = `{width:1280,height:720,fitWidth:false,fitHeight:true}` |
| `editorEnvInfo` | đúng path 3.7.3 + `projectPath` |

---

## Chưa kết luận được

**`assetGetPreview` treo 25s, HTTP 000, không response.**
KHÔNG file là bug: `asset-tools.ts` nằm trong nhóm đã sửa, và `35ec127` đã vá đúng nhánh này
(`Panel.openBeside` không tồn tại trước 3.8 → fallback `Panel.open`). Phải reload editor rồi test lại.

**`asset-db/query-asset-thumbnail`** — cùng lý do, chưa verify được.

## Việc còn lại

1. Reload editor (`dist/` đã là `4832cf1`) → `curl /build-info` xác nhận, rồi test lại nhóm "đã sửa":
   `assetGetPreview` · `nodeGetTree` prefab-edit · `assetOperate` với uuid ·
   `inspectorSetSettingsProperties` · `nodeComponentsGet` type · `captureScreenshot` JPEG magic
2. Test 3 fix của `4832cf1` sau reload: `programOpen`→`execute`, `urlOpen`→`execFile`,
   `projectSetConfig` báo unsupported
3. Numeric arg: `d21acbd` sửa query parser đặt sau `app.use` → smoke này tránh arg số, cần test riêng

## Unresolved

1. Editor đang do session khác lái — tôi không tự reload. Ai reload?
2. `_tmp_30144_37c490430c1dcf6a9a772806c69733cb` (0 byte) editor rớt ở repo root, chưa xoá vì sợ đụng.
3. `programGetInfo` chưa test được với program **có thật** — chưa biết project này đăng ký program nào.
