# Changelog

## 2.1.0 — 2026-08-21 — game-complete enrich (CC Remoter 3x)

- **Enrich 46:** `assetResolvePath` -> accepts `reference` OR `assetPath`, returns `exists`/`isDirectory`/`type`/`importer` alongside `filesystemPath`/`url`/`uuid` (verified `query-path`/`query-url`/`query-asset-info`/`query-uuid`).
- **New +1:** `assetReadContent` (text read by uuid or db:// path, 512KB cap + binary guard, `maxBytes` override) -> 45 -> **46** (additive).
- **Enrich:** `editorSelect` +`hover`/`update` (`hover(type,uuid?)` null=hover-out, `update(type,uuid[])`) port verified from 2x `Editor.Selection` surface (`update`/`hover` exist on 3.7.3 `editor.d.ts`).
- **Enrich:** `materialQuery` +`physics_material` (`query-physics-material`, facade + registry), `assetDbQuery` +`db_info` (`query-db-info dbName`).
- **Rename 3x:** `cocos-code-mode-3x7` -> `cc-bridge-3x`, manual `cc3x7` -> `cc-bridge-3x` + alias `ccb3x` (JS `cc_bridge_3x`/`ccb3x`, compat `ccb-3x`/`ccb_3x`), package menu `CC Bridge 3x`, d.ts `cc-bridge-3x.d.ts`, bootstrap `cc-bridge-bootstrap.js`, skills `.claude/skills/cc-bridge-3x`, removed legacy `cc-code-mode` shim + `code-mode-references.d.ts`.

## 2.0.0 — 2026-08-19 — CC Remoter 3x (formerly Code Mode for Cocos Creator)

**Breaking:** consolidate 68 legacy+A1 tools -> **45** via 10 consolidated dispatchers. 26 legacy names removed from `/utcp`; consolidated surface is now the only one. Legacy method bodies kept (not registered) for `consolidated-tools.ts` delegation (`new LegacyTool().method()`).

- **A1 shims (68)** — `bacb693`: added 7 consolidated tools alongside 61 legacy (`deprecated` tag), both names coexisted.
- **2.0.0 (68->51)** — `d1975d9`: strip 17 legacy `@utcpTool` (`inspectorGet/Set*`, `inspectorGet*Definition`, `nodeComponentAdd/Remove`, `sceneOpen`+`editorOperate`, `build*` 5).
- **2.0.x (51->45)** — `df6a1c2`: add 3 consolidated (`previewManage` 4->1, `programManage` 3->1, `projectManage` 2->1), strip 9 legacy (`previewGetUrl`/`previewOpenInBrowser`/`assetGetPreview`/`editorGetScenePreview` + `programGetInfo`/`programOpen`/`urlOpen` + `projectGetConfig`/`projectSetConfig`). Net `68 - 26 = 45 = 35 standalone + 10 consolidated`.
- **Docs/decl** — `README` 45, `cc-bridge-3x.d.ts` +1 decorator, `docs/consolidated-migration.md` codemod 26 legacy, `scripts/smoke-utcp.js` expects 45 (consolidated `inspectorGetDefinition` + `previewManage`).
- **Perf already in this line** — `maxDepth`/`maxNodes`/`fields[]` tree budgets, `section` definition pagination, `fields[]` selective dump, `response-trimmer`, desc avg ~76 chars (see `docs/prompt-guidance-risks.md`, `a769a46` bench).

**Migration:** `docs/consolidated-migration.md` — one-line codemod `inspectorGetInstanceProperties`->`inspectorGet` etc., `sceneOpen`->`sceneManage`, `preview*/assetGetPreview`->`previewManage`, `program*/urlOpen`->`programManage`, `project*`->`projectManage`.

## 1.x

Pre-consolidation line (61 tools, `CocosEditor3x7` namespace, Creator `>=3.8.7`). See `main` history.
