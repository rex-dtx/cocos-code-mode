# Cocos Pilot with Code Mode MCP

Cocos Pilot is the Cocos Creator 3.x extension. It serves a UTCP manual from the running editor; Code Mode MCP registers that manual and exposes its tools to an AI agent through TypeScript. Identity glossary: `docs/architecture-identity.md` — `cce` (Creator Editor), `ccbe` (Extension artifact), `ccbi:ccp3x_<port>` (Instance/Endpoint), `ccbr` (Registry), `ccbt` (Toolset 321), `cm` (paradigm), `cmm` (adapter `@utcp/code-mode-mcp`), `bd` (Binding), `prs` (Presence). Cấm dùng `ccb` trần.

## Connection model

```text
[cce] --hosts--> [ccbe] --runs exs:port--> [ccbi:ccp3x_<port> http://localhost:<port>/utcp]
  |                    | publish/remove         |
  +------------------->[ccbr ~/.utcp_config.json] <--register_manual-- [cmm @utcp/code-mode-mcp] <--mcp stdio--> [agent cm]
  |                    | handshake(bd.iid)      | call_tool_chain
  +--- Editor.Message.request <---> [ccbi] -----+----> [ccbt:321 tools]
```

`ccbe` maintains `ccbr` (`~/.utcp_config.json`) automatically. Each `ccbe` publishes one stable `ccbi:ccp3x_<actual-port>` entry; there is no `ccp3x` bare latest pointer (C1 in `architecture-identity.md`). Legacy `ccp3x` discovery entries migrate to the port in their URL, not to whichever editor answers first. Do not register two templates for the same endpoint. A template name must match its URL port; ambiguous endpoints sharing a namespace are not selected.

## 1. Configure MCP (`mcp` → `cmm` → `ccbr`)

Add `cmm` (`@utcp/code-mode-mcp`) to the AI client. `cc-pilot` is the **MCP server key** (client-facing name for the `cmm` adapter); `@utcp/code-mode-mcp` remains the adapter package. `UTCP_CONFIG_FILE` points to `ccbr`.

```json
{
  "mcpServers": {
    "cc-pilot": {
      "command": "npx",
      "args": ["@utcp/code-mode-mcp"],
      "env": {
        "UTCP_CONFIG_FILE": "~/.utcp_config.json"
      }
    }
  }
}
```

Restart the AI client after changing its MCP configuration. Open the Cocos project and confirm **Cocos Pilot 3x → Status** reports the `ccbi:ccp3x_<port>` URL (`ccbr` entry) before registering. See `docs/architecture-identity.md` for `cce`/`ccbe`/`ccbi`/`ccbr`/`cmm`/`bd` naming.

## 2. Register the Cocos manual (`cmm` → `ccbi` → `bd`, C2)

At the beginning of an agent session, select the intended `ccbi:ccp3x_<port>` from **Status** or `ccbr` (`~/.utcp_config.json`), `register_manual` that exact per-port template, then `editorHandshake` to establish `bd`. Do not use bare `ccp3x` latest — each `cce` is a distinct `ccbi:ccp3x_<port>`. Do not hard-code a stale port.

```typescript
await register_manual({
  manual_call_template: {
    name: 'ccp3x_49650', // ccbi id — replace with the selected ccbi:ccp3x_<port>
    call_template_type: 'http',
    url: 'http://localhost:49650/utcp', // ccbi.url
    http_method: 'GET',
    content_type: 'application/json',
  },
});

const tools = await list_tools(); // must contain ccp3x_49650
const bd = await ccp3x_49650.editorHandshake({
  expectedProjectPath: 'G:/projects/my-game',
  timeoutMs: 1000,
});
// require bd.projectMatches === true && bd.probe.status === 'responsive' before mutations (C2)
```

`list_tools()` must include the selected `ccbi` namespace before continuing. After restarting `cce`, `ccbe` reload, or reconnect, re-register that `ccbi` and re-handshake — `bd.iid` changes invalidate old `reference` handles even when `port` is unchanged. Never fallback to another `ccbi` when the bound one is unavailable (C2).

## 3. Discover before acting (`cm` over `ccbt`)

Use the `cmm` management tools in this order (`cm` paradigm over `ccbt`):

1. `search_tools` with the task in natural language.
2. `tool_info` for the selected `ccbt` tool's TypeScript interface and constraints.
3. `call_tool_chain` to compose calls through `ccp3x_<port>.<tool>(args)` (e.g. `ccp3x_49650.nodeGetTree`).

Example (replace `ccp3x_49650` with the bound `ccbi`):

```typescript
const tree = await ccp3x_49650.nodeGetTree({ maxDepth: 2, fields: ['name', 'active'] });
return {
  root: tree.name,
  childCount: tree.children?.length ?? 0,
};
```

Keep returned `reference` handles for the next mutation (valid only for current `bd.iid`). Prefer `sceneBatchGet`, `assetBatchQuery`, and `nodeBatchSet` for independent operations. Use `executeJavascript` only when no dedicated `ccbt` tool represents the required editor action.

## Copy-ready agent instruction
```text
Cocos Pilot controls Cocos Creator 3.x through tools for scenes, nodes, components, inspector properties, assets, prefabs, animation, editor/project/build/preview, diagnostics, files, runtime input, and screenshots. Identity: cce=Creator Editor, ccbe=Extension, ccbi:ccp3x_<port>=Instance, ccbr=Registry ~/.utcp_config.json, ccbt=Toolset 321, cm=Code Mode paradigm, cmm=@utcp/code-mode-mcp adapter, bd=Binding {ccbi+project+iid}, prs=Presence. At session start select the intended ccbi:ccp3x_<port> from Status/ccbr, register_manual that exact ccbi, verify with list_tools, then ccbi.editorHandshake({expectedProjectPath}) → bd; require bd.projectMatches:true && probe.status:responsive before mutations. Discover first (search_tools → tool_info → ccbi.<tool> via call_tool_chain), retain references per bd.iid, use batch ops, and use executeJavascript only when no ccbt tool fits. Re-handshake after reconnect/restart; never fallback to another ccbi.
```

## Common workflows

### Inspect and modify a scene

1. `nodeGetTree` to locate a node and retain its `reference` (valid only for current `bd.iid`).
2. `nodeComponentsGet` or `inspectorGetDefinition` to discover the component/property shape.
3. `inspectorGet` for the specific field.
4. `inspectorSet` or `nodeBatchSet` for the mutation (C3: snapshot for undo).
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

1. Select the intended `ccbi:ccp3x_<port>` from `ccbr`/Status, `register_manual` that `ccbi`, confirm via `list_tools`, then `ccbi.editorHandshake` → `bd` (C2).
2. Discover the dedicated `ccbt` tool with `search_tools` before generating a `call_tool_chain` (`cm`).
3. Preserve `reference` only while `bd.iid` unchanged and a later step needs to mutate the matching object.
4. Re-register + re-handshake after `cce` restart, `ccbe` reload, port change, or `tool-not-found` (never fallback to another `ccbi`).

Keep the skill focused on workflow rules. The live `ccbt` manual remains the source of truth for tool names, TypeScript interfaces, and capabilities. Glossary: `docs/architecture-identity.md`.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `ccbi:ccp3x_<port>` tools missing | Select the intended `ccbi` in `ccbr`/Status, `register_manual` that `ccbi`, verify with `list_tools`, then `ccbi.editorHandshake` → `bd` (C2). |
| Connection fails | Confirm `cce` is open and `ccbi.url` / `ccbr` port matches Status; `bd.probe.status` distinguishes responsive vs timeout vs error. |
| Duplicate tools | Remove duplicate templates pointing to the same URL; retain exactly one `ccbi:ccp3x_<port>` per endpoint with `name` matching URL port (C1). No bare `ccp3x` latest. |
| Source build does not change editor behavior | A junction removes copy/import work only. Restart `cce` to clear cached `ccbe` modules. |
| Manual points to an old editor | Re-select the intended `ccbi:ccp3x_<port>` explicitly, then re-register + re-handshake; discard old `reference` when `bd.iid` changes (C2). |
