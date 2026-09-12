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

### Send an agent log to the editor

Use `editorLog` instead of `executeJavascript` to write a message to the Creator console:

```typescript
return await ccb3x.editorLog({
  level: 'info',
  message: '[Agent] Finished checking the scene',
  data: { checkedNodes: 12, valid: true },
});
```

`level` is required: `debug`, `info`, `warn`, or `error`. `message` is required, trimmed, non-blank, and limited to 4096 characters. Optional `data` is appended as JSON and limited to 65536 UTF-8 bytes when serialized. The response contains `{ success: true, level, message }`. Invalid inputs return HTTP 400.

`debug` uses `console.log` with a `[debug]` prefix so the existing project-log reader can recognize it. Read entries back with `editorGetLogs`; use `showStack: true` when the message contains multiple lines. The tool follows normal profile exposure (full by default); enable it explicitly for a core/custom profile. After rebuilding, reload the extension and re-register the manual to discover the new API.

### Ask the user or collect structured input

Both tools appear in the full `/utcp` manual after rebuilding/reloading the extension and re-registering it. Enable them explicitly when using a core/custom profile.

**Nonblocking by default:** `editorAsk` uses choice buttons in the nonmodal **Agent Inbox**, and `editorPrompt` uses a form in the same panel. Neither automatically opens a window or moves focus. A pending request logs a short notice; the user opens **CC Bridge 3x > Agent Inbox** when convenient. An already open inbox updates through broadcasts without being activated. The response deadline includes time waiting for the user to open the inbox.

`openPanel: true` is an explicit opt-in to `Editor.Panel.open`, which may activate/focus the panel; omit it to avoid interrupting mouse/keyboard work. `editorAsk` additionally supports `presentation: 'native'` as explicit opt-in to a modal native dialog that can block/focus Creator. No foregrounding, OS input automation, or control focus is performed by the default tools.

```typescript
const answer = await ccb3x.editorAsk({
  title: 'Agent confirmation',
  message: 'Apply the inspected changes?',
  detail: 'Only the selected nodes will be modified.',
  type: 'question',
  buttons: ['Apply', 'Cancel'],
  cancelId: 1,
  timeoutMs: 60000,
});
return answer; // { buttonIndex, buttonLabel, cancelled, timedOut }
```

Buttons default to `['OK', 'Cancel']`; `cancelId` defaults to the final button. Pass 1–8 unique non-blank labels (maximum 80 characters each); the cancellation index must be inside that array. A selected cancellation button returns its index/label with `cancelled: true`; closing/cancelling the inbox returns null button fields.

Only with `presentation: 'native'`: Creator **3.7.3 has no public `Editor.Dialog.messageBox`**, so the implementation uses native `info`/`warn`/`error` wrappers with `buttons`, `default`, and `cancel` options. `question` maps to `info`; `warning` maps to `warn`. A cancellation button selection is indistinguishable from native Escape/window-close, so both set `cancelled`.

**A native timeout ends the API request, not the dialog.** It returns null button fields and `timedOut: true` (`cancelled: false`). Dismiss the remaining dialog in Creator; another native question returns `EDITOR_INTERACTION_BUSY` (409) until the original dialog settles. Late clicks cannot change the completed result.

```typescript
return await ccb3x.editorPrompt({
  title: 'Agent input',
  message: 'Choose how the selected scene should be updated.',
  fields: [
    { name: 'label', label: 'Display label', type: 'text', required: true, maxLength: 120 },
    { name: 'mode', label: 'Mode', type: 'select', options: ['Preview', 'Apply'], defaultValue: 'Preview', required: true },
    { name: 'reviewed', label: 'I reviewed the changes', type: 'confirm', required: true },
  ],
  timeoutMs: 120000,
});
```

`editorPrompt` posts to the dedicated **Agent Inbox** panel without opening it. Submit returns `{ requestId, submitted: true, cancelled: false, timedOut: false, values }`; cancel/Escape/panel-close and timeout return empty values and exactly their corresponding flag. Required confirmation fields must be checked. Optional text/select fields may return `''`; confirm fields return booleans. Invalid submissions stay open for correction. Closing the panel or restarting/unloading the extension cancels pending requests. Questions and forms share one inbox slot: concurrent requests are rejected with HTTP 409 instead of replacing the user's input.

Limits: both tools require a non-blank title (≤256 characters) and message (≤4096). Ask detail is ≤8192. Deadlines are 1–300000ms, default 60000ms, including panel startup. Prompts accept 1–16 fields with unique names matching `[A-Za-z][A-Za-z0-9_]{0,63}` (reserved `constructor`/`prototype`/`__proto__` rejected), labels ≤256, text ≤4096 (or lower `maxLength`), and 1–64 unique non-blank select options ≤256 characters. Text/selection defaults must fit their constraints. Unsupported properties, unsafe field names, and invalid values return HTTP 400.

Prompts render labels and options as text, never HTML. Request IDs reject stale/double responses; timers and active requests are cleared on every completion. The panel clears values on completion/deadline and remains open with status for reuse. Do not request passwords or secrets: submitted values travel through the normal tool response/debug logging pipeline. Only act on explicit submission/selection; cancellation and timeout are not approval.

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

## ALX-inspired CCB capabilities

CCB may adopt useful editor workflows observed in external tools, but the implementation remains independent. The current CCB-native additions include:

- `uiLayoutAlign` for bounded multi-node alignment and distribution.
- `nodeGetPath` for reverse UUID-to-hierarchy lookup.

Example:

```typescript
const path = await ccb3x.nodeGetPath({
  reference: { id: buttonUuid, type: 'cc.Node' },
  relativeTo: { id: canvasUuid, type: 'cc.Node' },
  includeRoot: false,
});
// path.path => "Panel/SpinButton"
```

For layout mutation, inspect the target nodes first, require stable references, and prefer `uiLayoutAlign` over manually calculating coordinates. It validates node count, duplicate references, UITransform data, and same-parent constraints, then reads the result back.

See:

- [ALX capability comparison](./alx-capability-comparison.md) for the independent reimplementation map.
- [Independent CCB strategy](./independent-ccb-strategy.md) for roadmap, qualification, and non-dependency rules.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `ccb3x` tools missing | Register the current manual, then verify with `list_tools`. |
| Connection fails | Confirm Cocos is open and its UTCP URL/port matches the active `ccb3x` template. |
| Duplicate tools | Remove duplicate templates pointing to the same URL; retain only canonical `ccb3x` for the latest editor. |
| Source build does not change editor behavior | A junction removes copy/import work only. Restart Cocos Creator to clear cached extension modules. |
| Manual points to an old editor | Re-register after restart, or select the required `ccb3x_<port>` entry for a specific editor. |
