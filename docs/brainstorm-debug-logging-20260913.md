# Debug Logging Control Design

## Problem

Agent and test interactions with Cocos Creator must be visible to the user without forcing verbose console noise. Debug logging needs a clear UI control, two logging modes, and per-project persistence.

## Agreed requirements

- Primary control: Configuration panel switch.
- Default mode: OFF.
- OFF: show warnings and errors only.
- ON: show verbose tool lifecycle events: start, complete, warning, error, status, duration, tool name, input keys, and result keys.
- Persist state per project through `Editor.Profile`.
- Toggle applies at runtime without restarting the UTCP server.
- Never log request values or full response payloads.
- Existing debug folder, JSONL logs, `editorGetLogs`, and clear/open actions remain compatible.

## Evaluated approaches

### Configuration panel plus Editor.Message — selected

One runtime source of truth in the server, controlled through the existing Creator extension message path. The panel reads and writes state; `main.ts` persists the value with `Editor.Profile`; server logging changes immediately.

Pros: matches existing extension architecture, no extra HTTP admin API, no restart, clear UI state, easy to extend with menu shortcut.

Risk: requires panel-to-main message wiring and startup synchronization.

### HTTP debug-status endpoint — rejected

Would add a management API and duplicate control paths. Adds exposure and synchronization complexity without user benefit.

### Profile read on every request — rejected

Adds IPC latency and failure surface to every tool call. Runtime state should be cached in the server and updated only on toggle.

## Proposed contract

```ts
type DebugLoggingState = {
  enabled: boolean;
  mode: 'quiet' | 'verbose';
};
```

The panel displays `OFF`/`ON` and explains the active behavior. `Editor.Profile` key: `debugLogging`, scoped by the extension's project profile.

## Implementation boundaries

- Add server getter/setter for debug state.
- Load persisted state during extension startup before serving normal traffic.
- Add an Editor.Message handler for panel updates.
- Add panel switch and current-state refresh.
- Keep `toggleDebug()` as a compatibility shortcut backed by the same state.
- Make interaction lifecycle logging conditional: successful start/complete only in verbose mode; warning/error always visible.
- Preserve redaction: keys and metadata only, no values/payload dumps.

## Validation

- Unit: default OFF; toggle transitions; persisted setting; filtering of successful lifecycle events; warning/error visibility in both modes.
- Live Creator: toggle OFF/ON from Configuration panel or message path; successful tool call visibility changes; error remains visible in both modes; restart restores per-project setting.
- Regression: build, full unit suite, existing debug-log viewer and clear/open actions.

## Decision

Implement the Configuration panel + Editor.Message approach with per-project persistence, default OFF, quiet warning/error mode, and verbose lifecycle mode.
