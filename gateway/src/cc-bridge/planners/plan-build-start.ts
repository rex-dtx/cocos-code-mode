import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planBuildStart(context: PlannerContext): GatewayDecision {
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
      effect: "external-side-effect",
      commands: [{
        op: "build.start",
        commandId: "build",
        usesHandles: [],
        args: { options: { source: "request", jsonPointer: "/inputs/options" } },
      }],
      preconditions: [{ kind: "build-task", revisionToken: request.observation?.revisionToken ?? "build", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "none" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 1, inputBytes: 8192, outputBytes: 4096, timeoutMs: 15000 },
    },
  };
}
