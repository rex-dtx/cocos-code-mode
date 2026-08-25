# CC Bridge 3x — Cocos Creator 3.7 bridge (UTCP)

**CC Bridge 3x** (formerly `cocos-code-mode-3x7`) turns the Cocos Creator Editor into an AI-controllable tool. It runs an HTTP server inside the editor that exposes scene manipulation, asset management, and property inspection as structured tool calls via [UTCP Protocol](https://www.utcp.io/) — letting AI agents build, inspect, and modify Cocos Creator projects the same way a developer would through the UI.
These tools are combined in [UTCP Code Mode](https://github.com/universal-tool-calling-protocol/code-mode/) environment to achieve maximum performance and token efficiency for AI agents, letting them call the tools in isolated JS sandbox.

## Quickstart

1. [Install extension](https://github.com/RomaRogov/cocos-code-mode/?tab=readme-ov-file#installation) in the Cocos Creator project
2. [Integrate](https://github.com/RomaRogov/cocos-code-mode/?tab=readme-ov-file#integration) extension with CodeMode MCP Server
3. Design a system prompt for you agent or use [provided example](https://github.com/RomaRogov/cocos-code-mode/blob/main/prompt_example.md)
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

## Tools (46 — 10 consolidated replaces 26 legacy + 1 additive)

![Tools <> UI Mapping](tools_screenshot.jpg)

> **2.0.x breaking:** 26 legacy tools removed (was 68 at A1 shims → 45 via 10 consolidated). Legacy 1.x clients must migrate — see `docs/consolidated-migration.md` + codemod. **2.1:** +1 `assetReadContent` (text read) → 46.

| Category | Tools | Purpose |
|----------|-------|---------|
| **Scene** (13) | `sceneGetInfo`, `findNodesByAsset`, `findNodesWithMissingAssets`, `nodeReset`, `callComponentMethod`, `listComponentMethods`, `listComponentClasses`, `nodeClipboard`, `nodeGetTree`*, `nodeGetAtPath`, `nodeCreatePrimitive`, `nodeCreate`, `nodeOperate` | Hierarchy, prefab, clipboard. *`nodeGetTree` bounded `maxDepth`=4/`maxNodes`=200 by default; `fields` filter |
| **Assets** (11) | `assetGetTree`*, `assetGetAtPath`, `assetResolvePath`, `assetReadContent`, `assetFindReferences`, `assetQuery`, `assetSaveContent`, `assetGetAvailableUrl`, `assetCreate`, `assetImport`, `assetOperate` | Browse/search/create/import/mutate. *`assetGetTree` bounded `maxDepth`=4/`maxNodes`=200 by default |
| **Inspector** (3) | `inspectorGet`*, `inspectorSet`*, `inspectorGetDefinition`* | Dump/set + TS definitions. *`fields[]`/`section` |
| **Components** (3) | `nodeGetAvailableComponentTypes`, `nodeComponentsGet`, `nodeComponentManage`* | Discover + attach |
| **Editor** (4) | `editorEnvInfo`, `editorViewport`, `editorSelect`, `editorHistory` + `editorQuery`*, `sceneManage`* | Viewport, selection, lifecycle |
| **Preview** (1) | `previewManage`* | `get_url`/`open_browser`/`asset_preview`/`scene_preview` (replaces 4: preview*, assetGetPreview, editorGetScenePreview) |
| **Program** (1) | `programManage`* | `get_info`/`open`/`open_url` (replaces 3: program*, urlOpen) |
| **Project** (1) | `projectManage`* | `get`/`set` (replaces 2: project*) |
| **Build** (1) | `buildManage`* | Panel, tasks, trigger, control (replaces 5) |
| **Animation** (2) | `animationQuery`, `animationEdit` | Slim clip dumps |
| **Material/DB** (2) | `materialQuery`, `assetDbQuery` | Effects/pipeline |
| **System** (2) | `editorGetLogs`, `propertyArrayElement` | Logs, array ops |
| **Consolidated** (10) | `inspectorGet/Set/Definition`, `nodeComponentManage`, `editorQuery`, `sceneManage`, `previewManage`, `programManage`, `projectManage`, `buildManage` | Replaces 26 legacy — now the only surface |

* QA: `scripts/smoke-utcp.js` (expects 46) · Perf: `a769a46` bench + `e419276` trim.


## How It Works

This extension architecture follows a **discover, then act** pattern. AI agents never guess at property names or component structures — they query for the real definitions first.

```
1. Get the scene tree         →  find the node you need
2. Get its type definition    →  learn its actual properties
3. Set properties by name     →  make precise changes
```

### Example

```typescript
// Preferred (consolidated): discover → set in one session
const tree = ccb3x.nodeGetTree({ maxDepth: 2, fields: ['name', 'active'] });
const ref = tree.children[0].reference;

// Single-class definition instead of full dump
const { definition } = await ccb3x.inspectorGetDefinition({ target: 'instance', reference: ref, section: 'UITransform' });

// Unified get/set — no need to pick inspector*Instance vs inspector*Settings
const { dump } = await ccb3x.inspectorGet({ target: 'instance', reference: ref, fields: ['position'] });
await ccb3x.inspectorSet({ target: 'instance', reference: ref, propertyPaths: ['position.x'], values: [120] });

// 2.0.0: legacy removed — use consolidated names above.
```

## Architecture

### Tool Execution

The extension runs an Express.js HTTP server on a configurable port (default: auto-assigned). Tool handlers execute asynchronously using Cocos Creator's Editor Message API — all editor interactions go through `Editor.Message.request`, which marshals calls to the appropriate editor subsystem.

- **Read tools** (GET) — query scene state and return structured data immediately.
- **Write tools** (POST) — mutate scene state and call `Editor.Message.request('scene', 'snapshot')` to register the change as an undoable step.

This means AI agents can safely chain read calls and batch writes without blocking the editor.

### Tool Discovery

Tools are TypeScript class methods decorated with `@utcpTool`. The `ToolRegistry` collects them at startup, builds JSON schemas from the inline definitions, and serves a UTCP manual at the `/utcp` endpoint.

```typescript
export class SceneTools {

    @utcpTool(
        'nodeGetTree',
        'Get the hierarchy tree of specific node or scene root if no reference is provided.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            }
        },
        SceneTreeItemSchema, "GET", ['scene', 'graph', 'node', 'hierarchy', 'tree']
    )
    async nodeGetTree(args: { reference?: IInstanceReference }): Promise<ISceneTreeItem> {
        // ...
    }
}
```

### Instance References

Nodes, components, and assets are passed around as lightweight UUID-based handles:

```typescript
{ id: "a1b2c3d4-...", type: "cc.Camera" }
```

Returned by tree queries, component lookups, and creation tools. Passed back to any tool that needs to target a specific object.

### TypeScript Definitions

Code Mode dynamically generates TypeScript class definitions from the live editor property dump. When an AI agent calls `inspectorGetInstanceDefinition`, it receives a complete TypeScript class with the correct field names, types, enums, and decorator hints — including `@property` attributes like `min`, `max`, `unit`, and `tooltip`.

```typescript
// Example output for a Transform-like node
export class Node {
    readonly uuid: string;
    /** World position */
    worldPosition: Vec3;
    /** World rotation (euler angles) */
    worldRotation: Vec3;
    worldScale: Vec3;
    active: boolean;
}
```

Components without special handling are reflected automatically from the serialized property dump. Common Cocos math types (`Vec2`, `Vec3`, `Vec4`, `Color`, `Rect`, `Quat`, `Mat4`, `Gradient`, etc.) are always available via `inspectorGetSettingsDefinition({ settingsType: 'CommonTypes' })`.

### Settings Inspection

Two special settings types can be inspected and modified directly:
- **`CurrentSceneGlobals`** — ambient light, skybox, shadows, and other scene-level rendering settings.
- **`ProjectSettings`** — engine and project configuration.

## Installation

### From release

1. Download last release from this repository.
2. Open Cocos Creator, go to **Extension → Extension Manager**, and click `Import Extension File(.zip)` button (icon with arrow).
3. Select the downloaded zip file.
4. The UTCP server starts automatically and registers itself in `~/.utcp_config.json` by default.

### Build from source

1. Clone this repository.
2. Install `node` and `npm`.
3. run
```bash
git clone https://github.com/romarogov/cocos-code-mode.git
cd cocos-code-mode
npm i
npm run package
```
4. If everything builds fine, `cc-bridge-3x.zip` file should appear in repository root.
5. Install it in Cocos Creator with **Extension Manager**.

## Adding Custom Tools

You should add custom tools right in extension package and build it from source as described above.

Implementation example:

```typescript
import { utcpTool } from './utcp/decorators';

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
        "POST",
        ['custom', 'tags']
    )
    async myCustomTool(args: { input: string, count?: number }): Promise<{ result: string }> {
        // Implementation
    }
}
```

Register the class by importing it in `utcp-server.ts`. Tools are served automatically at startup. No additional registration needed.

## UTCP Call Templates Configuration

The extension provides a **Configuration** panel accessible from the **Code Mode** top menu. It shows the current server port, the path to the UTCP config file, and lets you manage additional UTCP call templates to connect other UTCP-compatible tool providers (including MCP servers) into the same Code Mode execution context.

You can find Call Template structures in [UTCP documentation](https://www.utcp.io/protocols):
- [MCP Call Template](https://utcp.io/protocols/mcp#call-template-structure)
- [HTTP Call Template](https://utcp.io/protocols/http#call-template-structure) ([Streamable](https://utcp.io/protocols/http#call-template-structure), [SSE](https://utcp.io/protocols/http#call-template-structure))
- [CLI Call Template](https://utcp.io/protocols/cli#call-template-structure)
- [Text Call Template](http://utcp.io/protocols/text#call-template-structure)

The extension registers itself in `~/.utcp_config.json` as a single `ccb3x` entry pointing at the running server port, and rewrites the port when it changes. Legacy names (`cc-bridge-3x`, `cc3x7`, `ccb-3x`/`ccb_3x`) are migrated to `ccb3x` on save — the file must hold exactly one template per running server, duplicates cause double tool registration.

## Agent Prompt Guidance

When you wire this extension to an AI agent, add the following instructions to the agent's system prompt. It cuts 50-80% of response tokens by preventing raw tree dumps, and costs at most one extra round-trip when a summary needs to be materialized into ids.

```text
When returning data from ccb3x tools (manual `ccb3x`; legacy `cc-bridge-3x`/`cc3x7` migrated on save):
- Return stats/aggregates (counts, top-N) unless the question needs items.
- User asks list/find/which/show → return capped list with .slice(0, N), not count.
- Drop empty arrays/objects and deep subtrees a summary already answers.
- Keep reference/id for any node you may operate on in a next step (verbs: set/add/remove/destroy).
- If an aggregate looks anomalous (large branch, mixed active, errors), drill into that branch before concluding.
```

Full failure-mode analysis and trade-offs: [`docs/prompt-guidance-risks.md`](docs/prompt-guidance-risks.md).
Migration for consolidated tools (A1 shims → 45): [`docs/consolidated-migration.md`](docs/consolidated-migration.md).

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

### Claude Code Configuration

To set up a Claude Code agent to use Code Mode, open your project and run:

Linux/MacOS:
``` bash
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="~/.utcp_config.json" -- code-mode npx @utcp/code-mode-mcp
```

Windows:
``` powershell
claude mcp add --transport stdio --env UTCP_CONFIG_FILE="%userprofile%/.utcp_config.json" -- code-mode cmd /c npx @utcp/code-mode-mcp
```
