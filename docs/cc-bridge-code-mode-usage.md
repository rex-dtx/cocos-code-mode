# CC Bridge 2x with Code Mode MCP

CC Bridge 2x exposes the running Cocos Creator 2.4 editor through a UTCP manual. Code Mode MCP must register that live manual in each MCP process before an agent can call its tools.

## Connection model

```text
Cocos Creator 2.4
    │ writes current URL
    ▼
~/.utcp_config.json → http://localhost:<port>/utcp
    │
    ▼
Code Mode MCP → register_manual → ccb2x.<tool>(args)
```

The extension maintains two equivalent templates in `~/.utcp_config.json`:

- `ccb2x` — short alias; use this for new registrations.
- `cc-bridge-2x` — canonical template.

The server uses an auto-assigned port by default. Never hard-code it; restart can change it.

## Configure Code Mode MCP

Add Code Mode MCP to the AI client, then restart that client after changing its MCP configuration.

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

Open the Cocos project. **Extension → CC Bridge 2x → About** logs the current UTCP URL and config path.

## Required session bootstrap

At the start of every agent session:

1. Read the current `ccb2x` template from `~/.utcp_config.json`.
2. Register that complete template with `register_manual`.
3. Call `list_tools` and confirm at least one `ccb2x` tool exists.
4. Call tools through `call_tool_chain` only after registration succeeds.

```typescript
const template = {
  name: 'ccb2x',
  call_template_type: 'http',
  url: 'http://localhost:<current-port>/utcp',
  http_method: 'GET',
  content_type: 'application/json',
};

await register_manual({ manual_call_template: template });
const tools = await list_tools();
```

A cache file or `CK_CODE_MODE=ready` only describes a prior manual fetch. It does **not** prove the active Code Mode MCP process has registered the manual.

## Discover, then act

1. `sceneSnapshot` for the current hierarchy and stable node `uuid` values.
2. `componentQuery` or `nodeQuery` for actual component/property shape.
3. Use a dedicated mutation tool, such as `nodeSetProperty`, `nodeComponentManage`, `nodeMove`, or `batchSetProperties`.
4. Re-read the changed value when confirmation matters.

Keep a returned `uuid` only while a later action needs it. Prefer batch tools for independent operations. Use `sceneScript` only to invoke known scene handlers; do not guess IPC messages or property names.

## Retry and troubleshooting

| Symptom | Action |
| --- | --- |
| `manual not found` / `tool not found` | Re-read the config, re-register the current template, verify with `list_tools`, retry once. |
| Connection fails | Confirm Cocos is open and the active template URL matches the URL logged by **About**. |
| Tools appear twice | Keep one registration for the selected URL; do not register both `ccb2x` and `cc-bridge-2x` in the same MCP process. |
| Editor restarted | Re-run the bootstrap: its port and in-memory registration may have changed. |
| Scene preview unavailable | `editorGetScenePreview` returns a fallback note when Creator 2.4 lacks `scene:capture-screenshot`; report that result rather than applying 3.x viewport workflows. |
| Tool call still fails after one retry | Call `editorGetLogs` and report the error; do not retry in a loop. |

## Copy-ready agent instruction

```text
CC Bridge 2x controls Cocos Creator 2.4 through UTCP. At the start of every MCP session, read the live ccb2x template from ~/.utcp_config.json, register it with register_manual, and verify it with list_tools before calling ccb2x tools. Discover state before mutations: sceneSnapshot, then nodeQuery/componentQuery, then a dedicated mutation tool; retain uuid values only while needed and re-read when confirmation matters. The cache is metadata only, not proof of registration. After a restart, port change, manual-not-found, or tool-not-found response, re-register once; on continued failure call editorGetLogs.
```
