# Consolidated Migration (cc3x7 A1 shims → 45 tools)

> Branch `cc-3x7` — A1 keeps legacy tools as deprecated shims. Next major removes them and lands at 45 tools (61 → 68 → 45).

## Mapping (7 consolidated replace 16 legacy)

| Consolidated (preferred) | Replaces | Legacy status |
|---|---|---|
| `inspectorGet` | `inspectorGetInstanceProperties` + `inspectorGetSettingsProperties` | `@deprecated` |
| `inspectorSet` | `inspectorSetInstanceProperties` + `inspectorSetSettingsProperties` | `@deprecated` |
| `inspectorGetDefinition` | `inspectorGetInstanceDefinition` + `inspectorGetSettingsDefinition` | `@deprecated` |
| `nodeComponentManage` | `nodeComponentAdd` + `nodeComponentRemove` | `@deprecated` |
| `editorQuery` | `editorIntrospect` + `editorListTypes` | `@deprecated` |
| `sceneManage` | `sceneOpen` + `editorOperate(save/close/soft_reload/save_as)` | `@deprecated` |
| `buildManage` | `buildPanelOpen` + `buildGetTasksInfo` + `buildGetTask` + `buildTrigger` + `buildTaskControl` | `@deprecated` |

Current `/utcp` count: **68** (61 legacy + 7 consolidated). Target next major: **45** (drop 16 legacy, add back ~ -2 for partial overlaps already counted).

## One-line codemod

```ts
// before
inspectorGetInstanceProperties({ reference, fields: ['position'] })
inspectorGetSettingsProperties({ settingsType: 'CurrentSceneGlobals' })
sceneOpen({ reference })
editorOperate({ operation: 'save_scene_or_prefab' })
editorIntrospect({ category: 'ready' })
editorListTypes({ category: 'importers' })
nodeComponentAdd({ reference, componentType: 'cc.Sprite' })
buildGetTasksInfo({})

// after
inspectorGet({ target: 'instance', reference, fields: ['position'] })
inspectorGet({ target: 'CurrentSceneGlobals' })
sceneManage({ operation: 'open', reference })
sceneManage({ operation: 'save' })
editorQuery({ category: 'ready' })
editorQuery({ category: 'importers' })
nodeComponentManage({ operation: 'add', reference, componentType: 'cc.Sprite' })
buildManage({ operation: 'tasks_info' })
```

## `target` / `operation` enums

- `inspectorGet` `target`: `instance` | `CurrentSceneGlobals` | `ProjectSettings`
- `inspectorGetDefinition` `target`: `instance` | `CommonTypes` | `CurrentSceneGlobals` | `ProjectSettings`
- `sceneManage` `operation`: `open` | `save` | `save_as` | `close` | `soft_reload`
- `buildManage` `operation`: `panel_open` | `tasks_info` | `get_task` | `trigger` | `control`

## Perf notes (cc3x7 already shipped, cc2x4 backlog)

`maxDepth`/`maxNodes`/`fields[]` (tree), `section` pagination (definitions), `fields[]` selective dump, `response-trimmer`, desc avg 76 chars — all benefit more via consolidated entry points because the agent picks one surface. See sync ledger `notes/plans/cc-code-mode-cst/1-wip-260819__tbd-cc-sync-backlog/`.

## Removal timeline

- **Now (A1):** both names work; consolidated has tag `consolidated`, legacy has `deprecated`.
- **Next major:** delete legacy `@utcpTool` registrations; `code-mode-references.d.ts` drops legacy signatures.
- **Prompt guidance** already prefers consolidated names — see `prompt-guidance-risks.md`.

## Testing

`npx tsc --noEmit` passes; `/utcp` must list 68 tools before and 45 after removal. `scripts/smoke-utcp.js` will be updated to 45 when shims drop.
