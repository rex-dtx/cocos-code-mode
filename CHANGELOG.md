# Changelog

## 2.0.0 — 2026-08-19

**Breaking:** consolidate 68 legacy+A1 tools → **45** via 10 consolidated dispatchers. 26 legacy names removed from `/utcp`; consolidated surface is now the only one. Legacy method bodies kept (not registered) for `consolidated-tools.ts` delegation (`new LegacyTool().method()`).

- **A1 shims (68)** — `bacb693`: added 7 consolidated tools alongside 61 legacy (`deprecated` tag), both names coexisted.
- **2.0.0 (68→51)** — `d1975d9`: strip 17 legacy `@utcpTool` (`inspectorGet/Set*`, `inspectorGet*Definition`, `nodeComponentAdd/Remove`, `sceneOpen`+`editorOperate`, `build*` 5).
- **2.0.x (51→45)** — `df6a1c2`: add 3 consolidated (`previewManage` 4→1, `programManage` 3→1, `projectManage` 2→1), strip 9 legacy (`previewGetUrl`/`previewOpenInBrowser`/`assetGetPreview`/`editorGetScenePreview` + `programGetInfo`/`programOpen`/`urlOpen` + `projectGetConfig`/`projectSetConfig`). Net `68 - 26 = 45 = 35 standalone + 10 consolidated`.
- **Docs/decl** — `README` 45, `code-mode-references.d.ts` 45+1 decorator, `docs/consolidated-migration.md` codemod 26 legacy, `scripts/smoke-utcp.js` expects 45 (consolidated `inspectorGetDefinition` + `previewManage`).
- **Perf already in this line** — `maxDepth`/`maxNodes`/`fields[]` tree budgets, `section` definition pagination, `fields[]` selective dump, `response-trimmer`, desc avg ~76 chars (see `docs/prompt-guidance-risks.md`, `a769a46` bench).

**Migration:** `docs/consolidated-migration.md` — one-line codemod `inspectorGetInstanceProperties`→`inspectorGet` etc., `sceneOpen`→`sceneManage`, `preview*/assetGetPreview`→`previewManage`, `program*/urlOpen`→`programManage`, `project*`→`projectManage`.

## 1.x

Pre-consolidation line (61 tools, `CocosEditor3x7` namespace, Creator `>=3.8.7`). See `main` history.
