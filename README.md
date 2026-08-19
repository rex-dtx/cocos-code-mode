# Code Mode for Cocos Creator 2.4.x

**Code Mode** turns the Cocos Creator Editor into an AI-controllable tool. It runs an HTTP server inside the editor that exposes scene inspection, asset management, and property reading as structured tool calls via [UTCP Protocol](https://www.utcp.io/) — letting AI agents inspect and reason about Cocos Creator projects the same way a developer would through the UI.
These tools are combined in [UTCP Code Mode](https://github.com/universal-tool-calling-protocol/code-mode/) environment to achieve maximum performance and token efficiency for AI agents, letting them call the tools in isolated JS sandbox.

> **This is the 2.4.x port.** It is a fork of the 3.x extension, rebuilt against the Creator 2.4 editor API. The two editor generations share almost no extension surface: 3.x routes everything through `Editor.Message.request`, which does not exist in 2.4. See [Differences from the 3.x extension](#differences-from-the-3x-extension).
>
> **Round 1 is read-only** — 10 tools, 27 operations. The only mutation is editor selection. Write tools (create/modify/delete node, asset, component) are not ported yet.
>
> Verified against **Creator 2.4.15**. Other 2.4.x patches are untested.

## Quickstart

1. [Install the extension](#installation) in the Cocos Creator 2.4.x project
2. [Integrate](#integration) it with the CodeMode MCP Server
3. Design a system prompt for your agent or use the [upstream example](https://github.com/RomaRogov/cocos-code-mode/blob/main/prompt_example.md) — note it describes the 3.x tool set
4. Ask AI to help you and see how it learns!

## What is Code Mode?

In contrast to rigid MCP tool defenitions, which always kept in LLM context, CodeMode is an approach which helps AI to call tools in the most familiar way - by writing JavaScript code based on TypeScript defenitions of tools. This helps AI to keep token consumption low, implement loops and chained calls for complex tasks, organize output in compact form and reuse output from different existing servers and endpoints in one JavaScript execution context, isolating LLM context from unnecessary data.
This opens endless possibilities for interaction between different environments. Here is some examples:
1. Move scene from blender with [Blender MCP](https://github.com/ahujasid/blender-mcp), exporting particular objects as FBX straight into Cocos project
2. Use [Figma MCP](https://www.figma.com/mcp-catalog/) to fetch UI layout from figma and implement these layouts in your project in the smart way instead of blindly recreating every panel
3. Use [Unity Code Mode](https://github.com/RomaRogov/unity-code-mode) to perform game porting between engines
4. Bring your own examples 🙃

All this becomes possible with community-friendly, flexible and open solution from UTCP team: [CodeMode](https://github.com/universal-tool-calling-protocol/code-mode) and it's MCP Server.
You can read more about Code Mode concept in papers from [Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp), [Apple](https://machinelearning.apple.com/research/codeact) and [Cloudflare](https://blog.cloudflare.com/code-mode/).

## Tools

10 tools, 27 operations. Most tools take an `operation` argument instead of being split into many endpoints — fewer tool definitions in the agent's context.

| Tool | Operations | Purpose |
|---|---|---|
| `sceneSnapshot` | — | **Start here.** Whole node tree in one round trip: transform, size, anchor, component list per node, plus design resolution. Editor-only roots filtered out. Guarded by `maxDepth` and `maxNodes`. |
| `nodeQuery` | `tree` `dump` `info` `functions` `by_component` `at_path` | Hierarchy tree, single-node property dump, node info, callable functions, find by component, fetch by path |
| `componentQuery` | `props` `classes` `by_name` `find` | Read one component's properties, list registered classes, find nodes carrying a component |
| `listComponentMethods` | — | List callable method names per component on a node (discovery for `callComponentMethod`, ported from v3). Groups by class name; 2.x message returns names, not uuids. |
| `assetResolve` | `uuid_from_url` `url_from_uuid` `fspath` `exists` | Translate between asset url, uuid, and filesystem path |
| `assetQuery` | `search` `tree` `info` `meta` `types` `sub_assets` `used_by` | Browse and inspect the asset database, including which scene nodes reference an asset (`used_by`) |
| `assetReadContent` | — | Read a text asset's contents |
| `editorSelect` | `query` `select` `unselect` `clear` | Read and set the editor selection — the one mutating tool |
| `editorEnvInfo` | — | Editor / engine / node / electron versions and project path |
| `projectGetConfig` | — | Read `settings/*.json` |

### Payload limits

Tree and list results are capped, because an agent asking for "the scene" on a real project would otherwise get hundreds of kilobytes. Every cap reports that it fired, so a clipped result is never mistaken for a complete one.

| Tool | Limit | Default | Reported as |
|---|---|---|---|
| `sceneSnapshot`, `nodeQuery tree` / `at_path` | `maxDepth` — how deep | 6 / 6 / 3 | `truncated: 'maxDepth'` on the node |
| `sceneSnapshot`, `nodeQuery tree` / `at_path` | `maxNodes` — how many | 400 | `truncated: 'nodeLimit'`, `childrenOmitted`, plus `nodesVisited` / `budgetExhausted` on the response |
| `componentQuery find`, `classes` | `maxResults` | 200 | `truncated: true`, with `total` still the real count |
| `assetQuery search` | `limit` | 200 | `truncated: true`, with `total` the real count |
| `assetQuery used_by` | `maxResults` | 200 | `truncated: true`, with `total` the number returned |
| `assetReadContent` | `maxBytes` + text-extension allowlist | 512 KB | throws rather than truncating |
| `nodeQuery dump` | `types` block dropped | — | `typesOmitted: [...]`, pass `includeTypes` to get it |

`maxDepth` alone is not enough: a slot scene is often one root with a thousand siblings, which no depth limit bounds. `maxNodes` is a single budget shared across all roots.

### Not in round 1

| | Why |
|---|---|
| All write tools | Node/asset/component mutation needs undo integration and the 2.4 scene write API, neither verified yet |
| `editorGetLogs` | 2.4.15 has no console read API — verified, all three candidate messages fail |
| 19 asset importers | `.meta` format differs from 3.x |

## How It Works

This extension architecture follows a **discover, then act** pattern. AI agents never guess at property names or component structures — they query for the real definitions first.

```
1. sceneSnapshot              →  see the whole scene at once
2. componentQuery props       →  read a component's real property values
3. nodeQuery dump             →  full serialized dump of one node
```

### Example

```typescript
// One call gets the whole scene
const scene = CocosEditor.sceneSnapshot({});
// → { name, uuid, designResolution: {width, height}, children: [...] }

// Find every node with a Sprite — returns paths, not bare uuids
const sprites = CocosEditor.componentQuery({ operation: 'find', componentType: 'cc.Sprite' });
// → { result: [{ path: 'Canvas/bg', uuid: '...', name: 'bg' }], total: 1 }

// Read that Sprite's actual property values
const props = CocosEditor.componentQuery({
  operation: 'props',
  path: 'Canvas/bg',
  componentType: 'cc.Sprite'
});
// → { spriteFrame: { __ref: '<uuid>', __type: 'cc.SpriteFrame', __name: 'bg' }, ... }

// And the reverse: before changing an asset, ask what already uses it
const users = CocosEditor.assetQuery({ operation: 'used_by', url: 'db://assets/art/bg.png' });
// → { nodes: [{ path: 'Canvas/bg', uuid: '...', name: 'bg',
//               component: 'cc.Sprite', property: 'spriteFrame' }], total: 1 }
```

`used_by` reports the component and property, not just the node — knowing "node X uses it" without knowing which property still leaves you searching by hand. A reference nested in an array is reported with its index (`frames[1]`).

## Architecture

### Tool Execution

The extension runs an Express.js HTTP server on a configurable port (default: auto-assigned). Unlike the 3.x version there is no single message bus — 2.4 tool handlers reach the editor three different ways, depending on what the data lives in:

| Path | Used for | Helper |
|---|---|---|
| `Editor.assetdb.*` (main process, sync + callback) | all asset tools | `cbToPromise` |
| `Editor.Ipc.sendToPanel('scene', 'scene:query-*')` | hierarchy, node dump, node info | `sceneIpc` |
| `Editor.Scene.callSceneScript(...)` | anything needing live `cc.*` — snapshot, component props, find-by-component | `sceneScript` |

`callSceneScript` runs `dist/scene-script.js` inside the **scene process**, where the full engine runtime (`cc.director`, `cc.find`, `cc.js`) is available. That file must stay standalone CommonJS — it cannot import anything from the rest of the extension.

All three are callback-style in 2.4; `source/utcp/utils/ipc-promise.ts` wraps them into promises.

### Differences from the 3.x extension

| | 3.x | 2.4.x |
|---|---|---|
| Editor API | `Editor.Message.request(module, msg, ...)` | `Editor.assetdb`, `Editor.Ipc`, `Editor.Scene.callSceneScript` |
| Engine access | via message bus | scene-script running in the scene process |
| Async style | promises | callback-last `(err, result)` |
| Node / Electron | Node 18+ | Node 14 / Electron 13 — constrains dependency versions |
| Settings | `Editor.Profile` object assignment | must call `profile.set()`; plain assignment does not persist |
| Project config | editor API | read `<project>/settings/*.json` directly |
| Tool count | 59 | 9 (read-only) |

The behavioural traps found while porting — where the 2.4 docs disagree with the runtime — are recorded in [`docs/cocos-2x-api-notes.md`](docs/cocos-2x-api-notes.md). Read that before adding tools.

### Tool Discovery

Tools are TypeScript class methods decorated with `@utcpTool`. The `ToolRegistry` collects them at startup, builds JSON schemas from the inline definitions, and serves a UTCP manual at the `/utcp` endpoint.

```typescript
export class DeepReadTools {

    @utcpTool(
        'sceneSnapshot',
        'Start here to understand the open scene...',
        {
            type: 'object',
            properties: {
                maxDepth: { type: 'number', description: 'Max tree depth, default 6' }
            }
        },
        { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array' } } },
        'GET', ['scene', 'snapshot', 'hierarchy']
    )
    async sceneSnapshot(args: { maxDepth?: number }): Promise<any> {
        return sceneScript<any>('scene-snapshot', { maxDepth: args.maxDepth || 6 });
    }
}
```

### Node and asset identity

2.4 has no unified instance-reference handle. Nodes are addressed two ways depending on the tool:

- **uuid** — what `scene:query-*` messages return and accept (`nodeQuery dump/info/functions`)
- **path** — `Canvas/background`, resolved with `cc.find` in the scene process (`nodeQuery at_path`, `componentQuery props`)

`componentQuery find` returns both, so it is the usual bridge from "which nodes have X" to "read X".

Assets keep the 3.x-style url/uuid duality; `assetResolve` translates between url, uuid, and filesystem path.

## Installation

### From release

1. Download last release from this repository.
2. Open Cocos Creator, go to **Extension → Extension Manager**, and click `Import Extension File(.zip)` button (icon with arrow).
3. Select the downloaded zip file.
4. The UTCP server starts automatically and registers itself in `~/.utcp_config.json` by default.

### Build from source

1. Clone this repository, check out the `cc-2x` branch.
2. Install `node` and `npm`.
3. run
```bash
npm i
npm run package
```
4. If everything builds fine, `cocos-code-mode-2x.zip` file should appear in repository root.
5. Install it in Cocos Creator with **Extension Manager**.

`npm run package` runs `npm run check` first — build plus the scene-script budget self-check (`scripts/check-node-budget.js`), which verifies the tree-walk limits without needing Creator open. Run `npm run check` on its own while developing.

For development, a junction from `<project>/packages/cocos-code-mode-2x` to the repo works and does not trigger a reload loop.

## Adding Custom Tools

Add tools in `source/utcp/tools-2x/` and build from source as described above. Keep the 3.x tools in `source/utcp/tools/` alone — they are excluded from the build and kept only as a porting reference.

Implementation example:

```typescript
import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

export class MyTools {

    @utcpTool(
        'myCustomTool',
        'Describe what this tool does',
        {
            type: 'object',
            properties: {
                input: { type: 'string' },
                count: { type: 'number', default: 10 }
            },
            required: ['input']
        },
        { type: 'object', properties: { result: { type: 'string' } } },
        "GET",
        ['custom', 'tags']
    )
    async myCustomTool(args: { input: string, count?: number }): Promise<{ result: string }> {
        return { result: await sceneScript<string>('my-handler', args) };
    }
}
```

Register the class by importing it in `utcp-server.ts`. Tools are served automatically at startup. No additional registration needed.

Two things to know before writing a 2.4 tool:

- **Every argument arrives as a string** unless the express query-parser decoder runs. It only runs because `app.set('query parser', ...)` is called *before* the first `app.use()` in `utcp-server.ts` — moving it below breaks every numeric and boolean argument silently. Nothing tests this.
- **Reaching live `cc.*`** means adding a handler to `source/scene-script.ts` and calling it via `sceneScript`. That file runs in the scene process and must not import anything. Numbers in the last argument position get swallowed by 2.4 IPC — wrap arguments in an object.

## UTCP Call Templates Configuration

The extension registers itself in `~/.utcp_config.json` as a `cc2x4` entry pointing at the running server port, and rewrites the port when it changes.

> The **Configuration** panel from the 3.x version is not ported yet. The server starts automatically; to pin a port, set `serverPort` in `<project>/settings/cocos-code-mode-2x.json` (0 = auto-assign). Additional call templates must be added to `~/.utcp_config.json` by hand for now.

You can find Call Template structures in [UTCP documentation](https://www.utcp.io/protocols):
- [MCP Call Template](https://utcp.io/protocols/mcp#call-template-structure)
- [HTTP Call Template](https://utcp.io/protocols/http#call-template-structure) ([Streamable](https://utcp.io/protocols/http#call-template-structure), [SSE](https://utcp.io/protocols/http#call-template-structure))
- [CLI Call Template](https://utcp.io/protocols/cli#call-template-structure)
- [Text Call Template](http://utcp.io/protocols/text#call-template-structure)

The extension automatically maintains a `cc2x4` entry in UTCP Config pointing to the running server port.

## Agent Prompt Guidance

When you wire this extension to an AI agent, add the following instructions to the agent's system prompt. It cuts 50-80% of response tokens by preventing raw tree dumps, and costs at most one extra round-trip when a summary needs to be materialized into ids.

```text
When returning data from cc2x4 tools:
- Return stats/aggregates (counts, top-N) unless the question needs items.
- User asks list/find/which/show → return capped list with .slice(0, N), not count.
- Drop empty arrays/objects and deep subtrees a summary already answers.
- Keep uuid for any node you may operate on in a next step (verbs: set/add/remove/destroy).
- If an aggregate looks anomalous (large branch, mixed active, errors), drill into that branch before concluding.
```

Full failure-mode analysis and trade-offs: [`docs/prompt-guidance-risks.md`](docs/prompt-guidance-risks.md).

## Integration

Code Mode works with any UTCP-compatible client, including the [Code Mode MCP server](https://github.com/universal-tool-calling-protocol/code-mode/?tab=readme-ov-file#even-easier-ready-to-use-mcp-server) for AI assistants.

### MCP Server Config

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "npx",
      "args": ["@utcp/code-mode-mcp"],
      "env": {
        "UTCP_CONFIG_FILE": "~/.utcp_config.json"
      }
    }
  }
}
```

Claude Code Configuration

```bash
# Linux/macOS
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="~/.utcp_config.json" -- code-mode npx @utcp/code-mode-mcp
# Windows (PowerShell: %userprofile% expands; cmd: %userprofile%/.utcp_config.json)
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="%userprofile%/.utcp_config.json" -- code-mode cmd /c npx @utcp/code-mode-mcp
```
