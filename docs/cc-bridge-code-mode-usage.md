# CC Bridge with Code Mode MCP

CC Bridge is the Cocos Creator 3.x extension. It serves a UTCP manual from the running editor; Code Mode MCP registers that manual and exposes its tools to an AI agent through TypeScript.

## Connection model

```text
Cocos Creator → http://localhost:<port>/utcp → UTCP call template
              → Code Mode MCP → register_manual → ccb3x_<port>.* tools
```

The extension maintains `~/.utcp_config.json` automatically. Each editor has one stable `ccb3x_<actual-port>` template; there is no `ccb3x` latest-editor pointer. Legacy `ccb3x` discovery entries migrate to the port in their URL, not to whichever editor answers first. Do not register two templates for the same endpoint. A template name must match its URL port; ambiguous endpoints sharing a namespace are not selected.

Every launch defaults to an OS-assigned free port (`listen(0)`). Previously saved `serverPort` values are not reused. Set **Settings → Advanced → Fixed Port** or the `fixedServerPort` preference explicitly to use a fixed port; 0 restores automatic allocation. An occupied fixed port fails without switching to another endpoint. Status reports the actual listening port; Settings shows the configured preference.

Registry writers serialize read–modify–write using `<config-path>.ccb-lock`, then replace the JSON atomically. Instance ownership is stored in the supported `variables.CCB3X_OWNER_<port>` string field, committed with its endpoint; late cleanup cannot remove a newer owner. Lock acquisition fails after 5 seconds rather than overwriting another writer. After a crash, an abandoned lock requires operator cleanup: close all registry writers, inspect its `owner.json`, then remove that lock directory. Older extension versions do not participate in this locking protocol; upgrade all concurrent Creator instances before relying on it.

### Extension Status panel

The extension menu exposes **Status**, **Restart Server**, **Toggle Debug Logging**, **Open Logs**, and **Settings** for quick access. Toggle Debug Logging switches the current state and logs the resulting ON/OFF state; Status retains an explicit ON/OFF checkbox. Restart Server acts immediately and disconnects current agents. Status shows connection health first, with build/registry identifiers under Technical details. Check Status refreshes a read-only snapshot; no polling or automatic mutations. Restart Server, the explicit debug ON/OFF checkbox, Open Logs and confirmed Clear Logs are available in the panel. Restart disconnects current agents; reconnect and handshake again. Clear Logs affects the shared debug folder, including other editors. Settings provides copy-ready AI configuration; fixed port and registry path are hidden under Advanced and applied together with a restart. The extension no longer edits arbitrary shared-registry templates. Local HTTP checks verify this instance, not agent connectivity.

### Creator 3.7 module compatibility

`npm run build` and direct `node scripts/package.js` run `check:creator-load` before publishing an artifact. The gate loads every manifest entrypoint and compiled module under Creator's sibling-`.js` preference, then resolves deferred literal Node/package requires. It rejects dual-package dependencies whose `.cjs` entry has an ESM `.js` sibling even when ordinary Node tests pass. Do not repair this by patching Creator's global loader or editing dependency files.

Run `npm run check:creator-load` independently after dependency changes. The gate is a CommonJS-loader compatibility check, not a full Creator runtime emulator: Electron/`db://` modules and scene/UI behavior still require editor verification; any unresolved dynamic requires are reported. Dependency paths in a stack trace may resolve through junctions and do not identify the loaded extension build—check `/build-info` before reloading a live editor.

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

Restart the AI client after changing its MCP configuration. Open the Cocos project and confirm **CC Bridge 3x → Status** reports a verified HTTP handshake before registering tools.

## 2. Register the Cocos manual

At the beginning of an agent session, explicitly select the intended Creator project and its `ccb3x_<port>` endpoint from Status or `~/.utcp_config.json`. Register that exact namespace and URL, then verify registration before calling tools. The examples below use **`ccb3x_49650` only as a selected-editor example**: replace the port and namespace with the actual selected editor. Never switch to another editor because the selected one is unavailable.

```typescript
await register_manual({
  manual_call_template: {
    name: 'ccb3x_49650',
    call_template_type: 'http',
    url: 'http://localhost:49650/utcp',
    http_method: 'GET',
    content_type: 'application/json',
  },
});

const tools = await list_tools();
```

`list_tools()` must include the selected `ccb3x_49650` manual before continuing. After a reconnect, CCB reload, or Creator restart, register the selected endpoint again and repeat the project/instance handshake. An unchanged port does not imply an unchanged server instance.

### Verify the connection and project

After registration, call the handshake through `call_tool_chain` so it exercises the same path as subsequent tools:

```typescript
const connection = await ccb3x_49650.editorHandshake({
  timeoutMs: 1000,
  expectedProjectPath: 'G:/projects/my-game',
});
return connection;
```

`editorHandshake` is read-only and always exposed, including custom profiles and explicit disabled-tool lists. It does not open panels or change scenes. Its response includes `instanceId` (new per server start), project path, editor version, build provenance, capture time, elapsed server processing time, and:

- `projectMatches`: true/false when an expected absolute path and actual project path are available; otherwise null. Comparison normalizes separators/trailing separators and is case-insensitive on Windows; symlinks are not resolved. A mismatch means reachable but the wrong target: do not mutate it.
- `probe.status`: `responsive`, `timeout`, `error`, or `invalid-response`. Only a boolean response from Creator's scene IPC counts as responsive. Failures carry `EDITOR_IPC_TIMEOUT`, `EDITOR_IPC_ERROR`, or `INVALID_EDITOR_RESPONSE` in `probe.code`.
- `probe.sceneReady`: true/false after a valid response, otherwise null. False means connected but the scene is not ready; it is not a disconnected editor.
- `probe.evidence`: `requestId`, `startedAt`, `ageMs`, `shared`, `settled`. Repeated observations of one hanging request retain the same ID. `settled` tracks actual IPC completion, not the wrapper deadline; `ageMs` is monotonic elapsed time. Repeated timeouts on that ID are not independent IPC failures.

The IPC deadline defaults to 1000ms (1–5000ms allowed); repeated probes share outstanding IPC rather than accumulating hung requests. This is a point-in-time check, not a persistent session or a guarantee that all tools will succeed. Client transport deadlines must allow additional HTTP/adapter overhead. Connection refused, registration failure, or an older build without this tool are client-side failures, not handshake responses. `/utcp` discovery alone does not prove Creator IPC readiness.

The SessionStart bootstrap announces `editorHandshake` and the exact per-port namespace to call. It probes unique endpoints with at most four editor probes (eight discovery HTTP requests) in parallel and an eight-second network budget within the ten-second hook. Each request has an absolute deadline, including connection and body receipt; HTTP errors are failures. It stores separate `handshake.status`, `checkedAt`, and `result` evidence in the metadata cache. `live` describes manual discovery, not Creator IPC readiness. Failed or omitted probes discard prior handshake success; older builds are marked `unsupported`. Unprobed 3.x cache entries are stale, not alternate live editors. Agents must still register the selected manual and handshake through Code Mode with the intended Creator project path (not necessarily the agent working directory).

Keep an agent-local binding of **namespace + endpoint + projectPath + instanceId** from the verified Code Mode handshake. Require `projectMatches:true` and `probe.status:responsive` before mutations; scene-dependent operations may also require `sceneReady:true`. Recheck after any reconnect/restart. A new `instanceId` invalidates old object references even when the namespace and port are unchanged. A project mismatch, ambiguous selection, or unreachable bound endpoint must stop mutation rather than trigger fallback to another editor. Independent agents may bind different editors without changing each other's routing.

If IPC stays stuck, do not poll in a tight loop. Restart/reload CCB to establish a new probe lifecycle, then re-register and handshake again. Starting a new CCB server clears stale probe slots; late responses from the previous lifecycle cannot evict current probes. A timeout alone never clears a slot or triggers background retries. This does not cancel an outstanding Creator IPC or guarantee recovery if Creator itself remains unresponsive.

### External health watchdog

After verifying the selected editor through Code Mode, run this outside Creator while actively working:

```sh
node scripts/cc-bridge-watchdog.js --url http://localhost:49650/utcp --project "G:/projects/my-game" --instance "<verified instanceId>"
```

Use the actual binding, never a cached latest alias. `--once` performs one check. Defaults are a 5-second interval and 2-second absolute HTTP deadline; polling is serial, one outstanding request per watcher. JSONL observations distinguish Healthy, Degraded, Unresponsive and Recovering, with reason, latency, safeToMutate and requiresReadback. A scene not ready is not a freeze, but does not permit scene mutations. Wrong project/instance requires explicit rebinding, never automatic acceptance.

This is an advisory agent-side monitor, not a server-side mutation lock. An agent must stop writes on unsafe or stale observations. Never repeat a timed-out mutation automatically: its outcome is unknown. After failures, read back the affected state and re-handshake through Code Mode; only then restart the watchdog to clear the conservative read-back latch. It does not kill/restart Creator, switch editors, or predict all freezes. Import/build can legitimately delay responses; initial thresholds need tuning with real editor measurements. Built-in Electron/Creator freezes can prevent CCB's own timers from firing, hence the independent process and client deadline.

### Session connections in Status

Status shows registered session heartbeats with lastSeen, age and Active (up to 15s), Stale (up to 60s), or Expired. Check Status refreshes this snapshot; absence means no heartbeat observed, not proof that no agent exists. Presence is instance-scoped and cleared on server restart. Session IDs must be unique per chat/harness session; labels and transport are caller-reported, not authenticated identities or evidence that the model is working.

For token-free HTTP helper presence, the session harness can supervise this foreground process after verifying the binding:

```sh
node scripts/cc-bridge-session.js --url http://localhost:49650/utcp --project "G:/projects/my-game" --instance "<verified instanceId>" --session "<unique chat session id>" --label "My session helper"
```

The helper verifies the binding and sends `editorSessionHeartbeat` every 5s with transport `http-helper`. It emits state changes only; normal beats never enter the model context. The harness must terminate it when the session ends; an orphan helper proves only that helper is alive. SIGINT/SIGTERM attempts a bounded close; a crash ages to Stale/Expired. Nothing starts automatically from a chat message or bootstrap. `--once` leaves a single observation to expire naturally.

`--interval-ms` is limited to 1000–10000ms so normal polling leaves deadline margin below the 15-second Active threshold. At most 100 sessions are retained; expired observations remain visible for up to five minutes, but may be evicted earlier to admit a new session when capacity is full. IDs and labels reject control characters. Unique session IDs are a caller obligation: this local presence API is not an authentication or ownership-lock protocol.

An adapter that actually invokes heartbeat through Code Mode can call `editorSessionHeartbeat({ sessionId, label, expectedInstanceId, transport: 'code-mode', operation: 'beat' })` and `operation:'close'` on shutdown. The transport label is still self-reported, not server verification of that route. Do not ask the model to send periodic tool calls: that would consume tokens. No external MCP package is patched; automatic heartbeat lifecycle requires harness integration.

## 3. Discover before acting

Use the Code Mode MCP management tools in this order:

1. `search_tools` with the task in natural language.
2. `tool_info` for the selected tool's TypeScript interface and constraints.
3. `call_tool_chain` to compose calls through `ccb3x_49650.<tool>(args)`.

Example:

```typescript
const tree = await ccb3x_49650.nodeGetTree({ maxDepth: 2, fields: ['name', 'active'] });
return {
  root: tree.name,
  childCount: tree.children?.length ?? 0,
};
```

Keep returned references for the next mutation. Prefer `sceneBatchGet`, `assetBatchQuery`, and `nodeBatchSet` for independent operations. Use `executeJavascript` only when no dedicated CC Bridge tool represents the required editor action.

## Copy-ready agent instruction

```text
CC Bridge controls Cocos Creator 3.x through tools for scenes, nodes, components, inspector properties, assets, prefabs, animation, editor/project/build/preview, diagnostics, files, runtime input, and screenshots. Select exactly one ccb3x_<port> namespace and endpoint for the intended Creator project. Register it with register_manual and verify it with list_tools, then call its editorHandshake with expectedProjectPath. Bind namespace + endpoint + projectPath + instanceId; require projectMatches:true and probe.status:responsive before mutations. Re-handshake after every reconnect/restart; discard old references on instanceId changes. Never fall back to another editor or a latest alias. Discover first, inspect current state before mutations, retain matching references, use batch operations, and use executeJavascript only when no dedicated tool fits.
```

## Common workflows

### Send an agent log to the editor

Use `editorLog` instead of `executeJavascript` to write a message to the Creator console:

```typescript
return await ccb3x_49650.editorLog({
  level: 'info',
  message: '[Agent] Finished checking the scene',
  data: { checkedNodes: 12, valid: true },
});
```

`level` is required: `debug`, `info`, `warn`, or `error`. `message` is required, trimmed, non-blank, and limited to 4096 characters. Optional `data` is appended as JSON and limited to 65536 UTF-8 bytes when serialized. The response contains `{ success: true, level, message }`. Invalid inputs return HTTP 400.

`debug` uses `console.log` with a `[debug]` prefix so the existing project-log reader can recognize it. Read entries back with `editorGetLogs`; use `showStack: true` when the message contains multiple lines. Use the optional case-sensitive `pattern` for bounded search and `maxBytes` (256-65536) to cap UTF-8 response size; a valid no-match query returns an empty result, while missing or unparseable logs fail explicitly. The tool follows normal profile exposure (full by default); enable it explicitly for a core/custom profile. After rebuilding, reload the extension and re-register the manual to discover the new API.

API lifecycle logs use indented plain text: `REQUEST`, `SUCCESS`, or `FAILED`, with a shared eight-character request token. Requests include merged query/body params; results describe the transmitted payload. Errors include params, message, details, recovery and stack when available. Multiline strings retain line breaks. Enable debug logging in Status to see successful traffic; quiet mode retains warnings/errors. Test-client trace is off unless `UTCP_TEST_TRACE=1`.

Console display is bounded to 112 lines, approximately 14,000 characters, eight nesting levels and 512 visited fields. Long strings are abbreviated explicitly. A `Details file` path is displayed only after a JSONL record is successfully written; warnings/errors are persisted even in quiet mode. Snapshots are bounded to 20,000 nodes, 32 levels, approximately two million characters and 262,144 characters per string; binary payloads and truncated content are marked, not represented as complete. Sensitive field names such as password, token, authorization and API key are redacted in both outputs. Redaction is name-based, not a free-text secret detector: never put credentials into messages, code strings or URLs.

### Ask the user or collect structured input

Both tools appear in the full `/utcp` manual after rebuilding/reloading the extension and re-registering it. Enable them explicitly when using a core/custom profile.

**Nonblocking by default:** `editorAsk` uses choice buttons in the nonmodal **Agent Inbox**, and `editorPrompt` uses a form in the same panel. Neither automatically opens a window or moves focus. Agent Inbox is no longer a menu entry; the panel/API remains available through explicit `openPanel: true` or the `open-agent-inbox` editor message. An already open inbox updates through broadcasts without activation. The response deadline includes waiting for the user.

`openPanel: true` is an explicit opt-in to `Editor.Panel.open`, which may activate/focus the panel; omit it to avoid interrupting mouse/keyboard work. `editorAsk` additionally supports `presentation: 'native'` as explicit opt-in to a modal native dialog that can block/focus Creator. No foregrounding, OS input automation, or control focus is performed by the default tools.

```typescript
const answer = await ccb3x_49650.editorAsk({
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
return await ccb3x_49650.editorPrompt({
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

### Quiet notifications and cooperative tasks

`editorNotify({ level: 'info', title, message })` immediately returns a notification ID and timestamp, writes a bounded editor-log entry, and quietly broadcasts updated Agent Inbox state. Levels are `info` (default), `warning`, and `error`. Title must be non-blank and at most 256 characters; message non-blank and at most 4096. Neither notifications nor progress opens or focuses a panel, uses a native dialog, or controls mouse/keyboard.

```typescript
const task = await ccb3x_49650.editorProgress({
  operation: 'start', title: 'Inspect assets', message: 'Reading metadata',
  progress: 0, timeoutMs: 60000,
});
// Perform bounded work steps, polling between them:
const state = await ccb3x_49650.editorTaskList({ taskId: task.taskId });
if (state.tasks[0]?.cancelRequested) {
  // First stop the actual work safely; only then acknowledge:
  return await ccb3x_49650.editorProgress({
    operation: 'finish', taskId: task.taskId, status: 'cancelled',
  });
}
await ccb3x_49650.editorProgress({ operation: 'update', taskId: task.taskId, progress: 50 });
// After the actual work completes:
return await ccb3x_49650.editorProgress({ operation: 'finish', taskId: task.taskId, status: 'completed' });
```

Tasks are tracking records, not a background execution engine. `start` returns `taskId`, `status: 'running'`, `cancelRequested: false`, epoch-millisecond `createdAt`/`updatedAt`/`expiresAt`, nullable `finishedAt`, and nullable progress. `update` accepts progress 0–100 and/or message ≤4096 characters (an empty update is a heartbeat). Each update renews the initial inactivity timeout: 1–300000ms, default 60000ms. `finish` requires `completed`, `failed`, or `cancelled`; completed sets progress to 100. Terminal records cannot be updated or finished again (409).

`editorTaskCancel({ taskId })` only sets a cooperative cancellation flag. It returns `{ task, requested: true, interrupted: false }` while running, including repeat requests; for terminal tasks `requested` is false. It never claims that work was interrupted, never renews the inactivity timeout, and never marks the task cancelled. The worker checks `cancelRequested`, stops safely, then explicitly finishes cancelled. `timedOut` means the tracking heartbeat went stale, **not** that underlying work stopped.

`editorTaskList({ status?, taskId?, limit? })` returns newest-created first, with `total` matching the filters and `truncated` indicating the list limit (default 50, maximum 100). At most 100 task records and 50 newest notifications are retained. Terminal tasks and notifications expire after five minutes; oldest terminal tasks may be evicted sooner to admit new work. Starting at capacity with all tasks running returns 409. Unknown/expired task IDs return 404 for update/finish/cancel, or an empty filtered list. Malformed inputs and operation-inappropriate fields return typed 400 `INVALID_ARGUMENT`. Restart/unload clears in-memory records.

`editorState({ timeoutMs? })` reads only project path, current scene identity, scene readiness/dirty state, task counts, and pending inbox metadata—never a scene tree or entered form values. Its read deadline defaults to 1000ms (1–5000ms allowed). Unavailable, rejected, malformed, or timed-out queries produce null fields and named `unavailable` entries rather than guessed idle/success. `busy.scene` means the scene is not ready; it is not a global Creator busy lock. `busy.tasks`/`busy.inbox` reflect this extension's running tasks/pending nonmodal request; native dialogs and other extensions' work are not tracked.

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

1. Select and register the intended `ccb3x_<port>` manual and confirm it through `list_tools`; handshake its project and instance before mutations.
2. Discover the dedicated tool with `search_tools` before generating a `call_tool_chain`.
3. Preserve references only while a later step needs to mutate the matching object.
4. Re-register and re-handshake after reconnect, Cocos/CCB restart, a port change, or a tool-not-found response. Keep the selected endpoint binding; never substitute another editor.

Keep the skill focused on workflow rules. The live manual remains the source of truth for tool names, TypeScript interfaces, and capabilities.

## ALX-inspired CCB capabilities

CCB may adopt useful editor workflows observed in external tools, but the implementation remains independent. The current CCB-native additions include:

- `uiLayoutAlign` for bounded multi-node alignment and distribution.
- `nodeGetPath` for reverse UUID-to-hierarchy lookup.

Example:

```typescript
const path = await ccb3x_49650.nodeGetPath({
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
| Selected `ccb3x_<port>` tools missing | Register that exact manual, then verify with `list_tools` and handshake. |
| Connection fails | Confirm the selected Creator project is open and its UTCP URL/port matches its namespace. Do not fall back to another editor. |
| Duplicate tools | Remove duplicate registrations for the same endpoint; retain one matching `ccb3x_<port>` namespace, not the legacy alias. |
| Source build does not change editor behavior | A junction removes copy/import work only. Restart Cocos Creator to clear cached extension modules. |
| Manual points to an old editor | Re-select the intended project endpoint explicitly, then register and handshake; discard old references when `instanceId` changes. |
