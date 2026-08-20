# Code Mode for Cocos Creator 2.4.x

**Code Mode** turns the Cocos Creator Editor into an AI-controllable tool. It runs an HTTP server inside the editor that exposes scene inspection, asset management, and property editing as structured tool calls via [UTCP Protocol](https://www.utcp.io/) — letting AI agents inspect and modify Cocos Creator projects the same way a developer would through the UI. Tools are combined in [UTCP Code Mode](https://github.com/universal-tool-calling-protocol/code-mode/) to call them from isolated JS sandbox with maximum token efficiency.

> **This is the 2.4.x port** of the 3.x extension, rebuilt against the Creator 2.4 editor API. The two generations share almost no extension surface: 3.x routes everything through `Editor.Message.request`, which does not exist in 2.4. See [Differences from the 3.x extension](#differences-from-the-3x-extension).
>
> Verified against **Creator 2.4.15**. Other 2.4.x patches are untested.

## Quickstart

1. [Install the extension](#installation) in a Cocos Creator 2.4.x project
2. [Integrate](#integration) it with the CodeMode MCP Server
3. Design a system prompt for your agent or use the [upstream example](https://github.com/RomaRogov/cocos-code-mode/blob/main/prompt_example.md) — note it describes the 3.x tool set; for 2.4 see [code-mode-references-2x.d.ts](code-mode-references-2x.d.ts)
4. Ask AI to help you and see how it learns!

## What is Code Mode?

In contrast to rigid MCP tool definitions kept in LLM context, CodeMode lets AI call tools by writing JavaScript against TypeScript definitions. This keeps token consumption low, allows loops and chained calls, and reuses output from different servers in one JS execution context.

Examples enabled by [UTCP Code Mode](https://github.com/universal-tool-calling-protocol/code-mode):
1. Move a scene from Blender with [Blender MCP](https://github.com/ahujasid/blender-mcp), exporting objects as FBX straight into Cocos
2. Use [Figma MCP](https://www.figma.com/mcp-catalog/) to fetch UI layout and implement it in the project
3. Use [Unity Code Mode](https://github.com/RomaRogov/unity-code-mode) to port games between engines

Read more: [Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp), [Apple](https://machinelearning.apple.com/research/codeact), [Cloudflare](https://blog.cloudflare.com/code-mode/).

## Tools

52 tools (13 files in `source/utcp/tools-2x/`). Most read tools take an `operation` argument instead of many endpoints — fewer definitions in agent context.

### Read — scene & components (8 tools)

| Tool | Operations | Purpose |
|---|---|---|
| `sceneSnapshot` | — | **Start here.** Whole node tree in one round trip: transform, size, anchor, component list per node, plus design resolution. Editor-only roots filtered. Guarded by `maxDepth` + `maxNodes`. |
| `sceneInfo` | — | Current scene header: name, uuid, designResolution, node count, bounds/dirty if available |
| `sceneOpen` | — | Open a scene asset by uuid or `db://` url (`_Scene.loadSceneByUuid` in scene process) |
| `sceneScript` | — | Probe: call any scene-script handler (`probe-*`, `open-scene`, `scene-info`, …) |
| `nodeQuery` | `tree` `dump` `info` `functions` `by_component` `at_path` | Hierarchy tree, single-node dump, node info, callable functions, find by component, fetch by path |
| `componentQuery` | `props` `classes` `by_name` `find` | Read one component's properties, list registered classes, find nodes by component |
| `listComponentMethods` | — | List callable method names per component on a node (discovery for `callComponentMethod`) |
| `animationQuery` | `clips_info` `clip_dump` `properties` `state` | Query `cc.Animation` on a node: clip list, clip dump, all props, state |

### Write — scene & components (18 tools)

| Tool | Purpose |
|---|---|
| `nodeSetProperty` | Set node property (`x`, `y`, `active`, …) or component property (`compType` like `cc.Sprite`); `isSubProp` forwarded to `setPropertyByPath` |
| `nodeSetPropertyUndo` | Undo-aware via `scene://set-property-by-path`; `isSubProp` forwarded |
| `batchSetProperties` | Batch set on many nodes; each op can be `undo:true` + `isSubProp:true` (verify + direct fallback) |
| `sceneSetPropertyHL` | High-level `scene://utils/scene.setProperty` (undo-aware), `isSubProp` forwarded |
| `nodeCreate` | Create node (`cc.Node`) under parent or scene root |
| `sceneCreateNodeHL` | High-level `scene://utils/scene.createNodes` (undo-aware), falls back to `cc.Node` |
| `nodeRemove` | Remove node (`removeFromParent`) |
| `nodeDuplicate` | Duplicate node (`cc.instantiate`) |
| `nodeMove` | Reparent node + optional `siblingIndex` |
| `nodeComponentManage` | `add` / `remove` component (`cc.Sprite`, `cc.Label`, …) |
| `nodeCreatePrimitive` | Primitive 3D node (Cube/Sphere/Capsule/…) |
| `callComponentMethod` | Call a component method by name (discovery via `listComponentMethods`) |
| `nodeReset` | Reset transform via `resetPropertyByPath` |
| `editorUndo` | `undo` / `redo` via `scene:undo` / `scene:redo` |
| `nodeClipboard` | `copy` / `cut` / `paste` / `duplicate` via scene panel + `cc.instantiate` |
| `animationEdit` | Stub — edit `.anim` via `assetWriteContent` on 2.4 |
| `sceneNew` | New empty scene (`scene:new-scene` IPC, fire-and-forget — save first) |
| `prefabSync` | Apply prefab edits back to prefab asset (`scene:set-prefab-sync`, forum #41, fire-and-forget) |

### Read — assets (7 tools)

| Tool | Operations | Purpose |
|---|---|---|
| `assetResolve` | `uuid_from_url` `url_from_uuid` `fspath` `exists` `exists_by_path` `is_sub_asset` `contains_sub_assets` `mount_info` `relative_path` `backup_path` | Translate between url/uuid/fspath + existence/isSubAsset/mount/relative/backup helpers |
| `assetQuery` | `search` `tree` `info` `meta` `metas` `types` `sub_assets` `used_by` | Browse/inspect asset db; `metas` = live `queryMetas` (circular-safe); `used_by` = reverse asset → node. Search `assetTypes` accepts CSV string OR `string[]` |
| `assetReadContent` | — | Read text asset content |
| `assetGetPreview` | — | Thumbnail/base64 for texture/prefab/material (falls back to `sharp` for png/jpg) |
| `editorListTypes` | `creatable_assets` `asset_types` `importers` | Vocabularies from `assettype2name` + scene panel probes |
| `editorGetLogs` | — | Last N lines from `temp/logs/project.log` |
| `editorGetScenePreview` | — | Scene screenshot (tries `scene:capture-screenshot`, fallback note on 2.4) |

### Write — assets (9 tools)

| Tool | Purpose |
|---|---|
| `assetCreateFolder` | Create folder under `db://assets` (+ `refresh`) |
| `assetWriteContent` | Write text asset (creates if not exists, + `refresh`) |
| `assetMove` | Move/rename (`Editor.assetdb.move`) |
| `assetGetAvailableUrl` | Non-colliding `db://` url (suffix `_1`…) |
| `assetRefresh` | Refresh at `db://` url; returns `results[]` (`create/delete/change/uuid-change`) |
| `assetSaveMeta` | Save `.meta` JSON (`saveMeta(uuid, JSON-string)`) — `metaJson` string or `meta` object |
| `assetImport` | Import external raw files into `db://` → `results[]` (uuid/url/path/type) |
| `assetExchangeUuid` | Swap uuids of two assets (keep references) |
| `assetDelete` | Delete asset/folder (`Editor.assetdb.delete` + `fs` fallback) |

### Editor / project / program / preview (10 tools)

| Tool | Purpose |
|---|---|
| `editorSelect` | `query`(`globalActive`/`contexts`/`confirmed`) / `select`(`confirm`) / `unselect`(`confirm`) / `clear` / `hover` / `set_context` / `patch` / `filter` / `confirm` / `cancel` — selection only, not scene mutation; `hover` 1 id (omit=out), `filter` mode `top-level|deep|name` |
| `editorEnvInfo` | Editor / engine / node / electron versions + project path |
| `editorOperate` | `save_scene` (`scene:stash-and-save`) / `refresh_assets` |
| `projectGetConfig` | Read `settings/*.json` |
| `projectSaveConfig` | Write `settings/*.json` key |
| `previewGetUrl` | Game preview server URL |
| `previewOpenInBrowser` | Open preview in system browser |
| `programGetInfo` | Registered external program info |
| `programOpen` | Launch registered program |
| `urlOpen` | Open `http(s)` URL in system browser |

Agent-facing TypeScript surface: [code-mode-references-2x.d.ts](code-mode-references-2x.d.ts) (hand-written, 52 entries).

### Payload limits

| Tool | Limit | Default | Reported as |
|---|---|---|---|
| `sceneSnapshot`, `nodeQuery tree` / `at_path` | `maxDepth` | 6 / 6 / 3 | `truncated: 'maxDepth'` |
| `sceneSnapshot`, `nodeQuery tree` / `at_path` | `maxNodes` | 400 | `truncated: 'nodeLimit'`, `childrenOmitted`, `nodesVisited` / `budgetExhausted` |
| `componentQuery find`, `classes` | `maxResults` | 200 | `truncated: true`, `total` is real count |
| `assetQuery search` | `limit` | 200 | `truncated: true`, `total` is real count |
| `assetQuery used_by` | `maxResults` | 200 | `truncated: true` |
| `assetReadContent` | `maxBytes` + text-extension allowlist | 512 KB | throws rather than truncating |
| `nodeQuery dump` | `types` block dropped | — | `typesOmitted: [...]`, pass `includeTypes` to get it |

`maxDepth` alone is not enough: a slot scene is often one root with thousands of siblings — `maxNodes` is a single shared budget.

### Not ported (verified on 2.4.15)

| Group | Tool | Why |
|---|---|---|
| Build | `buildTrigger` etc. (5) | `Editor.Builder` 2.4 only has `on/once/removeListener` — no trigger API |
| Viewport gizmo | `editorViewport` | 6 messages probe `not found` |
| Introspect | `editorIntrospect` | 6 messages probe `not found` |
| Asset dep graph | `assetFindReferences` | No reference/dependency query API |
| Console read | old `editorGetLogs` via IPC | `console:query-logs` does not exist — new impl reads `temp/logs/project.log` |

Details: [docs/cocos-2x-api-notes.md](docs/cocos-2x-api-notes.md) (6 doc-vs-runtime traps, probe3 gate), [docs/api-2x-reference.md](docs/api-2x-reference.md) (forum API 92605 mapped to verified runtime + actual tool surface), [docs/forum-92605-cocos-2x-api.md](docs/forum-92605-cocos-2x-api.md) (forum 92605 raw dump offline), [docs/cocos-2x-port-architecture.md](docs/cocos-2x-port-architecture.md) (delta 2.4 vs 3.x).

## How It Works

**Discover, then act** — agents never guess property names, they query definitions first.

```
1. sceneSnapshot            →  see the whole scene at once
2. componentQuery props     →  read a component's real property values
3. nodeQuery dump           →  full serialized dump of one node
```

### Example

```typescript
// One call gets the whole scene
const scene = cc2x4.sceneSnapshot({});
// → { name, uuid, designResolution: {width, height}, children: [...] }

// Find every node with a Sprite — returns paths, not bare uuids
const sprites = cc2x4.componentQuery({ operation: 'find', componentType: 'cc.Sprite' });
// → { result: [{ path: 'Canvas/bg', uuid: '...', name: 'bg' }], total: 1 }

// Read that Sprite's actual property values
const props = cc2x4.componentQuery({
  operation: 'props',
  path: 'Canvas/bg',
  componentType: 'cc.Sprite',
});
// → { spriteFrame: { __ref: '<uuid>', __type: 'cc.SpriteFrame', __name: 'bg' }, ... }

// Reverse: what uses this asset?
const users = cc2x4.assetQuery({ operation: 'used_by', url: 'db://assets/art/bg.png' });
// → { nodes: [{ path: 'Canvas/bg', uuid: '...', name: 'bg',
//               component: 'cc.Sprite', property: 'spriteFrame' }], total: 1 }

// Mutate (write train — probe-verified)
const node = cc2x4.nodeCreate({ name: 'ScoreLabel', parentUuid: sprites.result[0].uuid });
cc2x4.nodeComponentManage({ operation: 'add', nodeUuid: node.uuid, compType: 'cc.Label' });
cc2x4.nodeSetProperty({ uuid: node.uuid, path: 'x', value: 120 });
cc2x4.editorOperate({ operation: 'save_scene' });
```

`used_by` reports component + property, not just node. Array refs include index (`frames[1]`).

## Architecture

The extension runs an Express HTTP server on a configurable port (default: auto-assigned). Unlike 3.x there is no single message bus — 2.4 handlers reach the editor three ways:

| Path | Used for | Helper |
|---|---|---|
| `Editor.assetdb.*` (main, sync + callback) | all asset tools | `cbToPromise` |
| `Editor.Ipc.sendToPanel('scene', 'scene:query-*')` | hierarchy, node dump, node info | `sceneIpc` |
| `Editor.Scene.callSceneScript(...)` | anything needing live `cc.*` — snapshot, component props, find-by-component, mutations | `sceneScript` |

`callSceneScript` runs `dist/scene-script.js` inside the **scene process**, where the full engine runtime (`cc.director`, `cc.find`, `cc.js`, `cc.engine.getInstanceById`) is available. That file must stay standalone CommonJS — it cannot import anything.

All three are callback-style in 2.4; `source/utcp/utils/ipc-promise.ts` wraps them into promises. `cc.engine.getInstanceById(uuid)` is the node resolver for every mutation (verified same-instance).

### Differences from the 3.x extension

| | 3.x | 2.4.x |
|---|---|---|
| Editor API | `Editor.Message.request(module, msg, ...)` | `Editor.assetdb`, `Editor.Ipc`, `Editor.Scene.callSceneScript` |
| Engine access | via message bus | scene-script in scene process |
| Async style | promises | callback-last `(err, result)` |
| Node / Electron | Node 18+ | Node 14 / Electron 13 |
| Settings | `Editor.Profile` object assignment | must call `profile.set()`; plain assignment does not persist |
| Project config | editor API | read `<project>/settings/*.json` directly |
| Tool count | 59 | 52 (read + write) |

Behavioural traps where docs disagree with runtime: [docs/cocos-2x-api-notes.md](docs/cocos-2x-api-notes.md). Read it before adding tools. Forum API map: [docs/api-2x-reference.md](docs/api-2x-reference.md).

### Tool Discovery

Tools are TypeScript class methods decorated with `@utcpTool`. `ToolRegistry` collects them at startup, builds JSON schemas, and serves a UTCP manual at `/utcp`.

```typescript
export class DeepReadTools {
    @utcpTool(
        'sceneSnapshot',
        'Start here to understand the open scene...',
        { type: 'object', properties: { maxDepth: { type: 'number', description: 'Max tree depth, default 6' } } },
        { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array' } } },
        'GET', ['scene', 'snapshot', 'hierarchy']
    )
    async sceneSnapshot(args: { maxDepth?: number }): Promise<any> {
        return sceneScript<any>('scene-snapshot', { maxDepth: args.maxDepth || 6 });
    }
}
```

### Node and asset identity

2.4 has no unified handle. Nodes are addressed two ways:
- **uuid** — from `scene:query-*` and `sceneSnapshot` (`nodeQuery dump/info/functions`, every `node*` mutation)
- **path** — `Canvas/background`, resolved with `cc.find` (`nodeQuery at_path`, `componentQuery props`)

`componentQuery find` returns both, so it bridges "which nodes have X" to "read X". Assets keep url/uuid duality; `assetResolve` translates.

## Installation

### From release

1. Download last release from this repository.
2. Open Cocos Creator → **Extension → Extension Manager** → `Import Extension File (.zip)`.
3. Select the downloaded zip.
4. The UTCP server starts automatically and registers itself in `~/.utcp_config.json`.

### Build from source

```bash
npm i
npm run package
```

`npm run package` runs `npm run check` first — build plus the scene-script budget self-check (`scripts/check-node-budget.js`), which verifies tree-walk limits without Creator open. Run `npm run check` while developing.

For development, a junction from `<project>/packages/cocos-code-mode-2x` to the repo works and does not trigger a reload loop.

## Adding Custom Tools

Add tools in `source/utcp/tools-2x/` and build from source. Keep the 3.x tools in `source/utcp/tools/` — they are excluded from the build and kept as porting reference.

```typescript
import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

export class MyTools {
    @utcpTool(
        'myCustomTool',
        'Describe what this tool does',
        { type: 'object', properties: { input: { type: 'string' }, count: { type: 'number', default: 10 } }, required: ['input'] },
        { type: 'object', properties: { result: { type: 'string' } } },
        "GET", ['custom', 'tags']
    )
    async myCustomTool(args: { input: string, count?: number }): Promise<{ result: string }> {
        return { result: await sceneScript<string>('my-handler', args) };
    }
}
```

Register by importing the class in `utcp-server.ts`. Two things to know:
- **Every argument arrives as a string** unless the express query-parser decoder runs. It only runs because `app.set('query parser', ...)` is called *before* the first `app.use()` in `utcp-server.ts` — moving it below breaks every numeric/boolean argument silently.
- **Reaching live `cc.*`** means adding a handler to `source/scene-script.ts` and calling it via `sceneScript`. That file runs in the scene process and must not import anything. Numbers in the last argument position get swallowed by 2.4 IPC — wrap arguments in an object.

## UTCP Call Templates Configuration

The extension registers itself in `~/.utcp_config.json` as a `cc2x4` entry pointing at the running server port, and rewrites the port when it changes.

> The **Configuration** panel from 3.x is not ported yet. The server starts automatically; to pin a port, set `serverPort` in `<project>/settings/cocos-code-mode-2x.json` (0 = auto-assign). Additional call templates must be added by hand for now.

Call Template structures: [MCP](https://utcp.io/protocols/mcp#call-template-structure) · [HTTP](https://utcp.io/protocols/http#call-template-structure) · [CLI](https://utcp.io/protocols/cli#call-template-structure) · [Text](http://utcp.io/protocols/text#call-template-structure)

## Agent Prompt Guidance

Add to the agent's system prompt — cuts 50-80% of response tokens:

```text
When returning data from cc2x4 tools:
- Return stats/aggregates (counts, top-N) unless the question needs items.
- User asks list/find/which/show → return capped list with .slice(0, N), not count.
- Drop empty arrays/objects and deep subtrees a summary already answers.
- Keep uuid for any node you may operate on in a next step (verbs: set/add/remove/destroy).
- If an aggregate looks anomalous (large branch, mixed active, errors), drill into that branch before concluding.
```

Trade-offs: [docs/prompt-guidance-risks.md](docs/prompt-guidance-risks.md).

## Integration

Works with any UTCP-compatible client, including the [Code Mode MCP server](https://github.com/universal-tool-calling-protocol/code-mode/?tab=readme-ov-file#even-easier-ready-to-use-mcp-server).

### MCP Server Config

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "npx",
      "args": ["@utcp/code-mode-mcp"],
      "env": { "UTCP_CONFIG_FILE": "~/.utcp_config.json" }
    }
  }
}
```

Claude Code:

```bash
# Linux/macOS
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="~/.utcp_config.json" -- code-mode npx @utcp/code-mode-mcp
# Windows (PowerShell: %userprofile% expands; cmd: %userprofile%/.utcp_config.json)
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="%userprofile%/.utcp_config.json" -- code-mode cmd /c npx @utcp/code-mode-mcp
```
