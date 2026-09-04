# Plan: Fail-loud audit + durable smoke suite

> **Ngày:** 2026-09-04 · **Branch:** `feat/ccb3x-fail-loud-smoke` (worktree `cc-code-mode-cst-fail-loud`) · **Type:** docs§2/§5 + Typed errors · **Risk:** T2 · **Trạng thái:** DONE — f78bf3f (follow-up 422+hasOwn+malformedPayload), 106/106 unit, tsc OK; live smoke gate pending user editor restart

## 0. Bối cảnh

- `docs/agent-tool-failure-modes.md` §2 (Chưa audit hết) + §5 (smoke suite chưa viết) vẫn là **Unresolved** — trước đó bản kế hoạch đã ghi nhận 60→86 tools nhưng chưa có regression guard có rễ. §7 đã mở rộng hợp đồng lỗi có kiểu (`ToolError` với `code`/`details`/`recovery`, `422`/`400`/`500`) nhưng chỉ 2 điểm (`prefab-json-tools` + `project-tools`) được dùng.
- `scripts/smoke-utcp.js` & `tests/live/manual.test.js` đã bao tải mức 1/3 (manual + một phần shape) nhưng **không so sánh `/build-info` với HEAD** (§4 rule 1), không có bảo vệ hợp đồng kiểu cho mỗi lần sửa độ ồn thất bại, và phụ thuộc live (bỏ qua khi editor tắt — không chạy trên CI).
- Số lượng `catch {}` rỗng = 8, `?? ''/[]/{}` trong các công cụ không đồng đều, nhiều trả về `success:true` mà không xác thực kết quả IPC. Một nửa đã được làm cứng bởi các cam kết hợp đồng gần đây (`asset-contract-audit`, `schema-input-validation`, `tool-error-contract`) nhưng các cạnh giữa các tool vẫn là silent.
- **Mục tiêu của plan này:** chạy audit §2 còn thiếu, sửa chỉ những violation thực sự làm che input bắt buộc, swallow failure, hoặc trả về thành công sai; đóng smoke guard §5 thành 2 tầng + hợp đồng có kiểu có thể chạy trên CI mà không cần editor; cập nhật §7/Unresolved trong docs.

## 1. Thiết kế

### G1 — Audit & sửa fail-loud (§2) — P1

**Quy tắc phân loại (từ §7 + §2:64):**
- Throw `ToolError` *chỉ khi* error class + input/resource state + recovery đều đã biết. Không invent code cho failure mơ hồ — leak full log và trả generic 500.
- 4 mẫu phải soi: (a) `?? ''/[]/{}` trên giá trị bắt buộc, (b) `catch {}` rồi đi tiếp, (c) `normalize/default` trước guard bắt buộc, (d) trả `{success:true}` khi chưa verify.

**Các site đã map (xác nhận bằng grep, sẽ verify lại per-file):**

| File | Dòng | Mẫu | Phân loại | Hướng sửa |
|------|------|-----|-----------|-----------|
| `asset-tools.ts:23` | `} catch (e) {}` trong `queryAssetsCompat` fallback | (b) swallow | Giữ silent-for-fallback nhưng comment intent; fallback thứ 2 là nguồn vérité — không phải user error, không throw typed |
| `asset-tools.ts:363` | `args.content ?? ''` trong `assetSaveContent` | (a) nullable default | Guard rỗng trước; `content` là required string — typed `INVALID_ARGUMENT` nếu `content` rỗng + recovery |
| `file-tools.ts:123` | `try { readdirSync } catch { return; }` → returns `undefined` cho `{files,total}` | (b)+(d) false success | Return `{files:[], total:0}` hoặc throw typed nếu `dir` không đọc được do permission vs not-found phân biệt được; guard không rỗng |
| `file-tools.ts:83,184` · `instruction-*.ts:87` · `prefab-json-tools.ts:134` | `try { refresh-asset } catch {}` | (b) best-effort refresh | Đúng là best-effort — asset-db refresh sau write chỉ là hint. Giữ swallow nhưng thêm `// best-effort: asset-db refresh is a hint` + không che lỗi chính (write đã throw nếu fail) |
| `set-properties-tool.ts:122` | `try { JSON.parse(t) } catch (e) {}` | (b) string-coercion probe | Probe parse: swallow đúng — chỉ thử, không phải operation. Giữ, comment intent |
| `ui-tools.ts:140,173` | `try { set-property on Label/SpriteFrame } catch {}` | (b) optional enrichment | Enrichment của `createButton`/`createSprite`: node đã tạo thành công, label/spriteFrame là decoration. Giữ swallow nhưng không báo success sai — node `reference` vẫn valid; success của node creation không phụ thuộc |
| `file/asset normalize trước guard` | `assetGetTree`/`assetCreate`/`assetOperate` đã fix (hasTarget pattern) | (c) | Đã fix ở `98f9ea6`/`af877cd` — verify không regress |

**Quyết định:** chỉ sửa site **thực sự che lỗi người gọi** (file-tools readdir + assetSaveContent empty). Các site best-effort/probe giữ swallow nhưng gắn comment intent để audit sau phân biệt.

### G2 — Smoke suite §5 — P1

Hiện `scripts/smoke-utcp.js` đã là Tier-1+Tier-3a. Thiếu:

1. **Tier-1 hardening — stale-build guard (§4 rule 1):** `GET /build-info` so với `git rev-parse --short HEAD` (hoặc `dist/build-info.json:commit`). Trùng khớp exact → pass; mismatch → fail với message `expected commit <HEAD> got <build-info.commit> — run npm run build + restart editor`. `smoke-utcp.js` hiện chỉ check `commit` tồn tại.

2. **Tier-2 — typed error contract shape (§7):** cho mỗi site sửa ở G1 + 2 site đã có typed error, assert HTTP `422` + `code` + `details` + `recovery` exact. Đây là guard chống regress cho §7.

3. **CI-runnable layer:** unit tests trong `tests/unit/` (như `tool-error-contract`, `asset-contract-audit`) — không cần editor. Dùng `requireDist` + `readSource` pattern. Live tests giữ lại nhưng không phải gate duy nhất.

**File:**
- `scripts/smoke-utcp.js` — thêm stale-build compare + typed-error smoke (behind `?typedErrors=1` hoặc unconditional).
- `tests/unit/fail-loud-contract.test.js` (mới) — source-level asserts: không còn `} catch {}` rỗng không comment, `readdir` catch trả về shape đầy đủ, `assetSaveContent` guard.
- `tests/unit/smoke-tier1-contract.test.js` (mới, nhỏ) — `GET /build-info` shape + manual strict-keys asserted at source level (để CI fail ngay cả khi không có editor).

**Không làm:** registry-wide per-tool live smoke cho toàn bộ 86 tools — vượt scope; chỉ guard các tool đã audit + 5 shape asserts hiện có.

### G3 — Docs sync

- `docs/agent-tool-failure-modes.md`: đánh §2 (Chỗ nên quét tiếp) đã audit xong G1 (liệt kê site giữ/swallow có lý do), đánh §5 đã có suite, cập nhật Unresolved #2/#3 thành done. Giữ nguyên §7 Follow-up (project/set-config 3.8 — ngoài scope).

## 2. Thứ tự & effort

| Task | File | Effort | Risk |
|------|------|--------|------|
| G1 file-tools readdir + assetSaveContent empty | `file-tools.ts`, `asset-tools.ts` | S | thấp |
| G1 annotate best-effort swallows | 5 files `// best-effort` / `// probe` | XS | thấp |
| G2 smoke: stale-build + typed-error | `scripts/smoke-utcp.js` | S | thấp |
| G2 unit contract tests | `tests/unit/fail-loud-contract.test.js` (+ nhỏ tier1) | S | thấp |
| G3 docs sync | `docs/agent-tool-failure-modes.md` | XS | thấp |

5 task, tổng <120 dòng code mới + docs. Song song được sau khi chốt G1 audit.

## 3. Verify

- `npm run typecheck` + `npm run build` pass trong worktree `cc-code-mode-cst-fail-loud`.
- `npm test` (test:unit) pass — bao gồm 2 file contract mới; không regression trên 17 file unit hiện có.
- `node scripts/smoke-utcp.js` (khi editor chạy) vẫn 86 tools; stale-build assert pass khi build-info khớp HEAD, fail có message actionable khi lệch.
- Typed-error smoke: `assetSaveContent` rỗng → 422 `INVALID_ARGUMENT` (hoặc generic 400 từ schema) + recovery; `readdir` trên dir không tồn tại → shape đầy đủ, không `undefined`.

## 4. Rủi ro & mitigate

| Rủi ro | Mitigate |
|--------|----------|
| Sửa swallow làm lộ lỗi best-effort refresh thành fail | Chỉ sửa site che lỗi người gọi; refresh giữ swallow + comment |
| Stale-build check fail trên CI không có git | Fallback đọc `dist/build-info.json` nếu `git rev-parse` không có |
| Typed error code invent cho failure mơ hồ | §7 rule: chỉ throw `ToolError` khi biết class+state+recovery; còn lại generic 422/500 với log đầy đủ |

## 5. Ngoài scope

- `assetGetPreview` prefab channel 3.8-only, `custom` 8 fix chưa test 3.8.x, `origin` fork — vẫn Unresolved, không thuộc plan này.
- Full 86-tool live matrix — backlog riêng.

## 6. Hoàn thành (2026-09-04)
- Commit 0b77033: fail-loud audit G1 + smoke tiers (stale-build + fail-loud contract) + unit guards
- Commit f78bf3f: review 7/10 warnings fixed — runtimeTools strict malformed payload, getProperties hasOwnProperty, smoke unconditional 422
- Codex review requested via `codex review --base cc-3x7` (see CodexReview task output)
- Gates: tsc --noEmit OK, npm run build OK, npm test 106/106 pass
- Pending: live smoke `node scripts/smoke-utcp.js` sau khi restart editor (dirty bi=2b1c5c-dirty)
