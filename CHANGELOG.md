# Changelog

## Unreleased — fail-loud audit + smoke suite (2026-09-04) — branch feat/ccb3x-fail-loud-smoke
- Đóng docs §2 audit: sweep toàn bộ source/utcp/tools theo 4 mẫu silent-failure — ?? default che required, catch rỗng nuốt lỗi, normalize trước guard, false-success; sửa verifiable outcomes (docs §2): set-property boolean check, restore-prefab boolean, move-array-element boolean + index, add-task, animation operation, validateScene diagnostics, nullish payloads → throw thay vì empty-but-healthy, image magic bytes check, simulateKeyCombo reject bad input; predicates `does not exist` được neo via isMessageNotExposed; empty catches removed/annotated best-effort.
- Đóng docs §5 smoke: stale-build so HEAD vs /build-info (fail-loud khi lệch build), fail-loud typed-body tier trong scripts/smoke-utcp.js, CI-runnable contract guard tests/unit/fail-loud-contract.test.js (106 tests pass), tsc --noEmit OK.
- Typed errors (§7) mở rộng: chỉ throw ToolError khi class+state+recovery đã biết, generic 5xx kèm full log cho ambiguous.

## 2.1.1 — 2026-08-23 — clean break + asset meta parity

- **Clean break:** bỏ hết compat `cc3x7`/`cc2x4` khỏi bootstrap/skill/smoke; `~/.utcp_config.json` chỉ nhận `cc-bridge-3x`/`ccb3x` + `cc-bridge-2x`/`ccb2x`. Xoá shim `scripts/code-mode-bootstrap.js`.
- **Parity gap #1 đóng:** `assetOperate` +`save_meta` (`save-asset-meta`) và `assetDbQuery` +`meta` (`query-asset-meta`) — cặp read-modify-write, ngang `assetSaveMeta` của 2x. Vẫn **46 tools** (chỉ thêm op).
- **Dọn tên sót:** `source/scene.ts` log tag, error message của `smoke-utcp.js`/`bench-utcp-tools.js`, README title/zip name → `cc-bridge-3x`.

## 2.1.0 — 2026-08-21 — game-complete enrich (CC Bridge 3x)

- **Enrich 46:** `assetResolvePath` -> accepts `reference` OR `assetPath`, returns `exists`/`isDirectory`/`type`/`importer` alongside `filesystemPath`/`url`/`uuid` (verified `query-path`/`query-url`/`query-asset-info`/`query-uuid`).
- **New +1:** `assetReadContent` (text read by uuid or db:// path, 512KB cap + binary guard, `maxBytes` override) -> 45 -> **46** (additive).
- **Enrich:** `editorSelect` +`hover`/`update` (`hover(type,uuid?)` null=hover-out, `update(type,uuid[])`) port verified from 2x `Editor.Selection` surface (`update`/`hover` exist on 3.7.3 `editor.d.ts`).
- **Enrich:** `materialQuery` +`physics_material` (`query-physics-material`, facade + registry), `assetDbQuery` +`db_info` (`query-db-info dbName`).
- **Rename 3x:** `cocos-code-mode-3x7` -> `cc-bridge-3x`, manual `cc3x7` -> `cc-bridge-3x` + alias `ccb3x` (JS `cc_bridge_3x`/`ccb3x`, compat `ccb-3x`/`ccb_3x`), package menu `CC Bridge 3x`, d.ts `cc-bridge-3x.d.ts`, bootstrap `cc-bridge-bootstrap.js`, skills `.claude/skills/cc-bridge-3x`, removed legacy `cc-code-mode` shim + `code-mode-references.d.ts`.

## 2.0.0 — 2026-08-19 — CC Bridge 3x (formerly Code Mode for Cocos Creator)

**Breaking:** consolidate 68 legacy+A1 tools -> **45** via 10 consolidated dispatchers. 26 legacy names removed from `/utcp`; consolidated surface is now the only one. Legacy method bodies kept (not registered) for `consolidated-tools.ts` delegation (`new LegacyTool().method()`).

- **A1 shims (68)** — `bacb693`: added 7 consolidated tools alongside 61 legacy (`deprecated` tag), both names coexisted.
- **2.0.0 (68->51)** — `d1975d9`: strip 17 legacy `@utcpTool` (`inspectorGet/Set*`, `inspectorGet*Definition`, `nodeComponentAdd/Remove`, `sceneOpen`+`editorOperate`, `build*` 5).
- **2.0.x (51->45)** — `df6a1c2`: add 3 consolidated (`previewManage` 4->1, `programManage` 3->1, `projectManage` 2->1), strip 9 legacy (`previewGetUrl`/`previewOpenInBrowser`/`assetGetPreview`/`editorGetScenePreview` + `programGetInfo`/`programOpen`/`urlOpen` + `projectGetConfig`/`projectSetConfig`). Net `68 - 26 = 45 = 35 standalone + 10 consolidated`.
- **Docs/decl** — `README` 45, `cc-bridge-3x.d.ts` +1 decorator, `docs/consolidated-migration.md` codemod 26 legacy, `scripts/smoke-utcp.js` expects 45 (consolidated `inspectorGetDefinition` + `previewManage`).
- **Perf already in this line** — `maxDepth`/`maxNodes`/`fields[]` tree budgets, `section` definition pagination, `fields[]` selective dump, `response-trimmer`, desc avg ~76 chars (see `docs/prompt-guidance-risks.md`, `a769a46` bench).

**Migration:** `docs/consolidated-migration.md` — one-line codemod `inspectorGetInstanceProperties`->`inspectorGet` etc., `sceneOpen`->`sceneManage`, `preview*/assetGetPreview`->`previewManage`, `program*/urlOpen`->`programManage`, `project*`->`projectManage`.

## 1.x

Pre-consolidation line (61 tools, `CocosEditor3x7` namespace, Creator `>=3.8.7`). See `main` history.
