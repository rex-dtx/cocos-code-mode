import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planRuntimeControl(
  context: PlannerContext,
  action: "pause" | "resume" | "set-time-scale" | "get-state",
): GatewayDecision {
  const { request, policy, correlationId, nowMs } = context;
  const binding = {
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
  };
  if (action === "get-state") {
    return {
      kind: "execute",
      correlationId,
      binding,
      envelope: {
        effect: "none",
        commands: [{ op: "runtime.control", commandId: "runtime", usesHandles: [], args: { action } }],
        preconditions: [],
        transaction: { mode: "read", onError: "stop", snapshot: "none" },
        return: { mode: "command-result", commandId: "runtime" },
        limits: { commandCount: 1, ipcCount: 1, inputBytes: 1024, outputBytes: 4096, timeoutMs: 5000 },
      },
    };
  }
  return {
    kind: "execute",
    correlationId,
    binding,
    envelope: {
      effect: "local-state",
      commands: [{
        op: "runtime.control",
        commandId: "runtime",
        usesHandles: [],
        args: action === "set-time-scale"
          ? { action, value: { source: "request", jsonPointer: "/inputs/value" } }
          : { action },
      }],
      preconditions: [{ kind: "lifecycle", revisionToken: request.observation?.revisionToken ?? "runtime", digest: request.observation?.digest ?? "c".repeat(64) }],
      transaction: { mode: "ordered-effect", onError: "stop", snapshot: "none" },
      return: { mode: "execution-summary" },
      limits: { commandCount: 1, ipcCount: 1, inputBytes: 1024, outputBytes: 4096, timeoutMs: 5000 },
    },
  };
}
