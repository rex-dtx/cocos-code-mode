import type { PlannerContext } from "../protected-tool-registry.ts";
import type { GatewayDecision } from "../protocol.ts";

export function planObservationResult(context: PlannerContext, jsonPointer = "/fields/parentUuid"): GatewayDecision {
  const { request, policy, correlationId, nowMs } = context;
  return {
    kind: "result",
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
    result: { type: "observation-value", jsonPointer },
    limits: { outputBytes: 4096, expiresInMs: 10_000 },
  };
}
