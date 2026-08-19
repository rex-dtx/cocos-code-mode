# Consolidated Migration — 2.0.0 (68→51)

> **2.0.0 shipped:** 17 legacy tools removed from `/utcp` registration. Consolidated 7 are now the only surface (51 total). 1.x clients using legacy names will get 404 until migrated.

## Mapping (7 consolidated replace 17 legacy — removed)

| Consolidated (keep) | Legacy removed in 2.0.0 | Status |
|---|---|---|
| `inspectorGet` | `inspectorGetInstanceProperties`, `inspectorGetSettingsProperties` | **removed** |
| `inspectorSet` | `inspectorSetInstanceProperties`, `inspectorSetSettingsProperties` | **removed** |
| `inspectorGetDefinition` | `inspectorGetInstanceDefinition`, `inspectorGetSettingsDefinition` | **removed** |
| `nodeComponentManage` | `nodeComponentAdd`, `nodeComponentRemove` | **removed** |
| `editorQuery` | `editorIntrospect`, `editorListTypes` | **removed** |
| `sceneManage` | `sceneOpen`, `editorOperate` (`save_scene_or_prefab`/`close`/`soft_reload`/`save_as` + preview ops) | **removed** |
| `buildManage` | `buildPanelOpen`, `buildGetTasksInfo`, `buildGetTask`, `buildTrigger`, `buildTaskControl` | **removed** |

**Count:** `68 (A1 shims) - 17 legacy = 51 (44 standalone + 7 consolidated)`. Prior doc's "45" was estimate (assumed extra merges); actual is **51**. Gap 6 to reach 45 needs 6 more merges — deferred to backlog with frequency data.

## One-line codemod (1.x → 2.0)

```ts
// before (1.x legacy, now 404)
inspectorGetInstanceProperties({ reference, fields: ['position'] })
inspectorGetSettingsProperties({ settingsType: 'CurrentSceneGlobals' })
sceneOpen({ reference })
editorOperate({ operation: 'save_scene_or_prefab' })
editorIntrospect({ category: 'ready' })
editorListTypes({ category: 'importers' })
nodeComponentAdd({ reference, componentType: 'cc.Sprite' })
buildGetTasksInfo({})

// after (2.0 consolidated)
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

## Notes (2.0)

- Legacy method bodies kept (not registered) — `consolidated-tools.ts` delegates via `new LegacyTool().method()`. No logic moved, no file deleted.
- `package.json` 1.0.0 → 2.0.0 (breaking), `code-mode-references.d.ts` drops 17 legacy signatures.
- `maxDepth`/`maxNodes`/`fields[]` (tree), `section` pagination, `fields[]` selective dump, `response-trimmer`, desc avg 76 chars remain. See vault `1-wip-260819__tbd-cc-sync-backlog`.

## Further consolidation to 45 (deferred)

6 more merges to reach 45 need debug-log frequency before choosing — candidates: `preview*`, `program*`, `project*`, `asset*` groups. See vault next-major plan gap note.
