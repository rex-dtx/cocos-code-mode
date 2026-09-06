import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planEditorViewport(context: PlannerContext): GatewayDecision {
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
      effect: "local-state",
      commands: [{
        op: "editor.viewport",
        commandId: "viewport",
        usesHandles: [],
        args: { action: "focus", target: { source: "request", jsonPointer: "/inputs/uuid" } },
      }],
      preconditions: [{ kind: "entity", revisionToken: request.observation?.revisionToken ?? "viewport", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "none" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 1, inputBytes: 2048, outputBytes: 2048, timeoutMs: 5000 },
    },
  };
}
