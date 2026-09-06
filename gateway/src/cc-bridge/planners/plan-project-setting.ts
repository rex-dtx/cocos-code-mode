import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planProjectWriteSetting(context: PlannerContext): GatewayDecision {
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
        op: "project.writeSetting",
        commandId: "write",
        usesHandles: [],
        args: {
          namespace: { source: "public-contract-constant", id: "project" },
          key: { source: "public-contract-constant", id: "title" },
          value: { source: "request", jsonPointer: "/inputs/name" },
        },
      }],
      preconditions: [{ kind: "lifecycle", revisionToken: request.observation?.revisionToken ?? "project", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "once-after-success" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 2, inputBytes: 4096, outputBytes: 4096, timeoutMs: 5000 },
    },
  };
}
