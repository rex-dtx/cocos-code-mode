# Cocos Pilot 2x with Code Mode MCP

Cocos Pilot 2x exposes the running Cocos Creator 2.4 editor through a UTCP manual. Code Mode MCP must register that live manual in each MCP process before an agent can call its tools.

## Connection model

```text
Cocos Creator 2.4
    │ publishes owner/project + current URL
    ▼
~/.utcp_config.json → ccp2x_<port> → http://localhost:<port>/utcp
    │
    ▼
Code Mode MCP → register_manual → editorHandshake(expectedProjectPath) → ccp2x_<port>.<tool>(args)
```

The extension publishes one owned `ccp2x_<port>` template per Creator editor instance with matching `CCP2X_OWNER_<port>` and `CCP2X_PROJECT_<port>` markers. Bare `ccb2x`/`cc-bridge-2x` entries from previous installs are foreign/unowned migration evidence, never active aliases. Select the exact per-port template for the intended project, verify `projectMatches:true` and `probe.status:'responsive'`, and discard old references when `instanceId` changes. Never infer ownership from a cached manual or a legacy entry.

The server uses an auto-assigned port by default. Never hard-code it; restart can change it.

## Configure Code Mode MCP

Add Code Mode MCP to the AI client, then restart that client after changing its MCP configuration.

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

Open the Cocos project. **Extension → Cocos Pilot 2x → About** logs the current UTCP URL and config path.

## Required session bootstrap

At the start of every agent session:

1. Read the current `ccp2x_<port>` template and `CCP2X_OWNER_<port>`/`CCP2X_PROJECT_<port>` markers from `~/.utcp_config.json` for the intended Creator project. Select exactly one matching owned entry.
2. Register that complete per-port template with `register_manual`; verify the matching namespace with `list_tools`.
3. Call `ccp2x_<port>.editorHandshake({expectedProjectPath,timeoutMs:1000})` using the intended absolute project path. Require matching project and responsive probe before a mutation; re-handshake after port/instance change. An unknown `sceneReady` is not proof of an open scene.

```typescript
const template = {
  name: 'ccp2x_53925', // replace 53925 with the selected registry port
  call_template_type: 'http',
  url: 'http://localhost:53925/utcp',
  http_method: 'GET',
  content_type: 'application/json',
};
await register_manual({ manual_call_template: template });
const tools = await list_tools(); // confirm selected ccp2x_53925
const binding = await ccp2x_53925.editorHandshake({
  expectedProjectPath: 'G:/projects/my-2x-game', timeoutMs: 1000,
});
if (binding.projectMatches !== true || binding.probe.status !== 'responsive') throw new Error('Wrong or unresponsive Creator project');
```

A cache file or `CK_CODE_MODE=ready` only describes a prior manual fetch. It does **not** prove the active Code Mode MCP process has registered the manual.

## Discover, then act

1. `sceneSnapshot` for the current hierarchy and stable node `uuid` values.
2. `componentQuery` or `nodeQuery` for actual component/property shape.
3. Use a dedicated mutation tool, such as `nodeSetProperty`, `nodeComponentManage`, `nodeMove`, or `batchSetProperties`.
4. Re-read the changed value when confirmation matters.

Keep a returned `uuid` only while a later action needs it. Prefer batch tools for independent operations. Use `sceneScript` only to invoke known scene handlers; do not guess IPC messages or property names.

`graphManage({operation:'build',source:'disk'})` explicitly builds the saved 2.4 `.fire` graph; `status/query/resolve/navigate/refs/validate` read that cache. Missing graph returns `GRAPH_NOT_BUILT`; `source:'auto'` and implicit refresh are unsupported. Graph handles are advisory T0/T1 evidence: confirm the exact scene and node live before writing. `prefabReferenceAudit` reads serialized `__uuid__` dependencies without mutating the prefab; `truncated:true` is never a valid audit result.

On a disposable Creator 2.4.15 project, a dirty worktree build returned project-matched responsive handshake and read-only positive/negative results for PNG `assetImporterAudit`, flat-prefab `prefabReferenceAudit`, `uiLayoutInspect`, disk-only `graphManage` (after replacing Node14-incompatible `randomUUID` with `randomBytes`) and instance-bound `editorSessionHeartbeat`. This is live functional smoke, **not** clean-artifact or packaged-release qualification. `source:'auto'` remains unsupported. Force-stopping Creator leaves a stale registry entry; remove only that exact stopped owner/port after independent liveness verification. Do not infer popup/action or 3.8 support.

## Retry and troubleshooting

| Symptom | Action |
| --- | --- |
| `manual not found` / `tool not found` | Re-read config, re-register the exact `ccp2x_<port>` template, verify with `list_tools`, re-handshake and retry once. |
| Connection fails | Confirm Creator is open and the bound per-port URL matches the URL logged by **About**; do not fall back to bare aliases. |
| Tools appear twice | Keep one registration for the selected per-port URL; stale bare aliases are not binding evidence. |
| Editor restarted | Re-run bootstrap and discard old references: port or instance ID may have changed. |
| Scene preview unavailable | `editorGetScenePreview` returns a fallback note when Creator 2.4 lacks `scene:capture-screenshot`; report that result rather than applying 3.x viewport workflows. |
| Tool call still fails after one retry | Call `editorGetLogs` and report the error; do not retry in a loop. |

## Copy-ready agent instruction

```text
Cocos Pilot 2x controls Cocos Creator 2.4 through UTCP. At the start of every MCP session, select the exact owned ccp2x_<port> registry entry for the intended project using CCP2X_OWNER_<port>/CCP2X_PROJECT_<port>, register it with register_manual, verify it with list_tools, then call editorHandshake with the expected absolute project path. Require projectMatches:true and probe.status:responsive before a mutation. Never use historical bare bridge aliases. On restart or instance change, discard old references and rebind. For saved .fire structure, graphManage is disk-only and requires an explicit build; verify any target live before writing. The cache is metadata, not registration proof. On a tool failure, re-register/re-handshake once; if it still fails inspect editorGetLogs.
```
