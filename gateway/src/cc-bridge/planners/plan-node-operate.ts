import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planNodeOperate(context: PlannerContext): GatewayDecision {
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
      effect: "project-write",
      commands: [{
        op: "scene.operateNode",
        commandId: "operate",
        usesHandles: [],
        args: {
          target: { source: "request", jsonPointer: "/inputs/uuid" },
          action: "reset",
        },
      }],
      preconditions: [{ kind: "entity", revisionToken: request.observation?.revisionToken ?? "node", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "once-after-success" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 2, inputBytes: 4096, outputBytes: 4096, timeoutMs: 5000 },
    },
  };
}
