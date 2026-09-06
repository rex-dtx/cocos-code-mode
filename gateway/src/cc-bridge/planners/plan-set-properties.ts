import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planSetProperties(context: PlannerContext): GatewayDecision {
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
        op: "scene.setProperties",
        commandId: "set",
        usesHandles: [],
        args: {
          target: { source: "request", jsonPointer: "/inputs/uuid" },
          values: [{
            property: { source: "public-contract-constant", id: "enabled" },
            value: { source: "request", jsonPointer: "/inputs/name" },
          }],
        },
      }],
      preconditions: [{ kind: "entity", revisionToken: request.observation?.revisionToken ?? "props", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "once-after-success" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 2, inputBytes: 8192, outputBytes: 4096, timeoutMs: 5000 },
    },
  };
}
