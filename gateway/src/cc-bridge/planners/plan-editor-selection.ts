import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planEditorSelection(context: PlannerContext): GatewayDecision {
  const { request, policy, correlationId, nowMs } = context;
  return {
    kind: "execute",
    correlationId,
    binding: {
      requestId: request.requestId,
      deviceId: request.deviceId,
      projectId: request.projectId,
      relayInstanceId: request.relayInstanceId,
      nonce: request.nonce,
      sequence: request.sequence,
      tool: request.tool,
      relay: { build: request.relay.build, packageHash: request.relay.packageHash },
      creatorRange: policy.creatorRange,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 10_000,
    },
    envelope: {
      effect: "none",
      commands: [{ op: "editor.selection", commandId: "selection", usesHandles: [], args: { action: "get" } }],
      preconditions: [],
      transaction: { mode: "read", onError: "stop", snapshot: "none" },
      return: { mode: "command-result", commandId: "selection" },
      limits: { commandCount: 1, ipcCount: 1, inputBytes: 1024, outputBytes: 8192, timeoutMs: 5000 },
    },
  };
}
