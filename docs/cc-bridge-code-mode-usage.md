# CC Bridge with Code Mode MCP

CC Bridge is the Cocos Creator 3.x extension. It serves a UTCP manual from the running editor; Code Mode MCP registers that manual and exposes its tools to an AI agent through TypeScript.

## Connection model

```text
Cocos Creator → http://localhost:<port>/utcp → UTCP call template
              → Code Mode MCP → register_manual → ccb3x.* tools
```

The extension maintains `~/.utcp_config.json` automatically. Its canonical template is `ccb3x`; when more than one editor runs, `ccb3x_<port>` identifies a specific editor. Do not register two templates for the same URL: duplicate registrations expose duplicate tools.

## 1. Configure the MCP bridge

Add Code Mode MCP to the AI client. `cc-bridge` is the client-facing server name; `@utcp/code-mode-mcp` remains the adapter package that implements the bridge.

```json
{
  "mcpServers": {
    "cc-bridge": {
      "command": "npx",
      "args": ["@utcp/code-mode-mcp"],
      "env": {
        "UTCP_CONFIG_FILE": "~/.utcp_config.json"
      }
    }
  }
}
```

Restart the AI client after changing its MCP configuration. Open the Cocos project and confirm **CC Bridge 3x → About** reports a running UTCP URL before registering tools.

## 2. Register the Cocos manual

At the beginning of an agent session, register the current Cocos template, then verify the registration before calling a tool. Use the port shown in the Configuration panel or the active `ccb3x` entry in `~/.utcp_config.json`; do not hard-code a stale port.

```typescript
await register_manual({
  manual_call_template: {
    name: 'ccb3x',
    call_template_type: 'http',
    url: 'http://localhost:<port>/utcp',
    http_method: 'GET',
    content_type: 'application/json',
  },
});

const tools = await list_tools();
```

`list_tools()` must include the `ccb3x` manual before the agent continues. After restarting Cocos Creator, repeat this bootstrap because the port and in-memory registration may have changed.

## 3. Discover before acting

Use the Code Mode MCP management tools in this order:

1. `search_tools` with the task in natural language.
2. `tool_info` for the selected tool's TypeScript interface and constraints.
3. `call_tool_chain` to compose calls through `ccb3x.<tool>(args)`.

Example:

```typescript
const tree = await ccb3x.nodeGetTree({ maxDepth: 2, fields: ['name', 'active'] });
return {
  root: tree.name,
  childCount: tree.children?.length ?? 0,
};
```

Keep returned references for the next mutation. Prefer `sceneBatchGet`, `assetBatchQuery`, and `nodeBatchSet` for independent operations. Use `executeJavascript` only when no dedicated CC Bridge tool represents the required editor action.

## Copy-ready agent instruction

```text
CC Bridge controls Cocos Creator 3.x through tools for scenes, nodes, components, inspector properties, assets, prefabs, animation, editor/project/build/preview, diagnostics, files, runtime input, and screenshots. At session start, register the current ccb3x UTCP manual with register_manual and verify it with list_tools before using tools. Discover first, then act: inspect current state before mutations, retain returned references, use batch operations where available, and use executeJavascript only when no dedicated tool fits.
```

## Common workflows

### Inspect and modify a scene

1. `nodeGetTree` to locate a node and retain its reference.
2. `nodeComponentsGet` or `inspectorGetDefinition` to discover the component/property shape.
3. `inspectorGet` for the specific field.
4. `inspectorSet` or `nodeBatchSet` for the mutation.
5. Read the changed field again when the task needs confirmation.

### Assets and prefabs

- Discover with `assetQuery`, `assetGetTree`, or `assetGetAtPath`.
- Resolve paths before creating/importing assets.
- Use `readPrefabJson` and `editPrefabJson` only for file-level prefab work; use node/inspector tools for live-scene edits.

### Diagnose runtime or scripts

- Start with `runScriptDiagnostics` and `getScriptDiagnosticContext`.
- Use runtime, screenshot, preview, or input-simulation tools for the requested surface.
- Confirm editor build provenance through `/build-info` when a result looks stale.

## Skills integration

A project skill that operates Cocos should treat registration as a session bootstrap, not an assumption:

1. Register the current `ccb3x` manual and confirm it through `list_tools`.
2. Discover the dedicated tool with `search_tools` before generating a `call_tool_chain`.
3. Preserve references only while a later step needs to mutate the matching object.
4. Re-register after Cocos restart, a port change, or a tool-not-found response.

Keep the skill focused on workflow rules. The live manual remains the source of truth for tool names, TypeScript interfaces, and capabilities.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `ccb3x` tools missing | Register the current manual, then verify with `list_tools`. |
| Connection fails | Confirm Cocos is open and its UTCP URL/port matches the active `ccb3x` template. |
| Duplicate tools | Remove duplicate templates pointing to the same URL; retain only canonical `ccb3x` for the latest editor. |
| Source build does not change editor behavior | A junction removes copy/import work only. Restart Cocos Creator to clear cached extension modules. |
| Manual points to an old editor | Re-register after restart, or select the required `ccb3x_<port>` entry for a specific editor. |
