import { CcbError } from "./errors.ts";
import { GatewayDecisionSchema } from "./schemas.ts";
import type { GatewayDecision, ProtectedRequest } from "./protocol.ts";

function pointerExists(root: unknown, pointer: string): boolean {
  if (!pointer.startsWith("/")) return false;
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return false;
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) return false;
      current = current[index];
    } else if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment as keyof typeof current];
    } else {
      return false;
    }
  }
  return true;
}

function visit(value: unknown, request: ProtectedRequest): void {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && "source" in value) {
    if (value.source === "request" && "jsonPointer" in value && typeof value.jsonPointer === "string" && !pointerExists(request, value.jsonPointer)) {
      throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value reference does not exist on the request.");
    }
    if (value.source === "observation" && "jsonPointer" in value && typeof value.jsonPointer === "string") {
      if (!request.observation || !pointerExists(request.observation, value.jsonPointer)) {
        throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value reference does not exist on the observation.");
      }
    }
  }
  for (const child of Object.values(value)) visit(child, request);
}

export function validateGatewayDecision(decision: unknown, request: ProtectedRequest): GatewayDecision {
  let parsed: GatewayDecision;
  try {
    parsed = GatewayDecisionSchema.parse(decision);
  } catch {
    throw new CcbError("CCB_PRIMITIVE_UNKNOWN", "Planner output failed the closed decision schema.");
  }
  const binding = parsed.binding;
  if (
    binding.requestId !== request.requestId
    || binding.deviceId !== request.deviceId
    || binding.projectId !== request.projectId
    || binding.relayInstanceId !== request.relayInstanceId
    || binding.nonce !== request.nonce
    || binding.sequence !== request.sequence
    || binding.tool.id !== request.tool.id
    || binding.tool.contractVersion !== request.tool.contractVersion
    || binding.tool.contractHash !== request.tool.contractHash
    || binding.relay.build !== request.relay.build
    || binding.relay.packageHash !== request.relay.packageHash
  ) {
    throw new CcbError("CCB_CONTRACT_MISMATCH", "Decision binding does not match the admitted request.");
  }
  visit(parsed, request);
  return parsed;
}
