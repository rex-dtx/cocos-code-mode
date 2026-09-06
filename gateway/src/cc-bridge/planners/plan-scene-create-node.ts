import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planSceneCreateNode(context: PlannerContext): GatewayDecision {
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
        op: "scene.createNode",
        commandId: "create-node",
        usesHandles: [],
        createsHandle: "node-1",
        args: {
          parent: { source: "observation", jsonPointer: "/fields/parentUuid" },
          name: { source: "request", jsonPointer: "/inputs/name" },
        },
      }],
      preconditions: [{
        kind: "observation",
        revisionToken: request.observation?.revisionToken ?? "missing",
        digest: request.observation?.digest ?? "0".repeat(64),
      }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "once-after-success" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 2, inputBytes: 4096, outputBytes: 4096, timeoutMs: 5000 },
    },
  };
}
