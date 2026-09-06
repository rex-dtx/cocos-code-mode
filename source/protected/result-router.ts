import { assertIJson, canonicalizeToBytes, IJson } from "./canonical-json";
import { CcbError } from "./errors";
import type { ExecutionEnvelope } from "./primitive-contract";
import type { GatewayDecision, ProtectedRequest } from "./protocol";

export interface LocalExecutionResult {
  commandResults: ReadonlyMap<string, unknown>;
  summary: unknown;
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer is not a valid JSON pointer.");
  let current = root;
  for (const encodedSegment of pointer.slice(1).split("/")) {
    const segment = encodedSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (/~(?:[^01]|$)/.test(encodedSegment)) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer contains an invalid escape.");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer does not select an array element.");
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer is outside the selected array.");
      current = current[index];
    } else if (current && typeof current === "object" && Object.getPrototypeOf(current) === Object.prototype) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer does not exist.");
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Result pointer traverses a non-container value.");
    }
  }
  return current;
}

function enforceResultLimit(value: unknown, maxBytes: number): IJson {
  assertIJson(value);
  const bytes = canonicalizeToBytes(value);
  if (bytes.byteLength > maxBytes) {
    throw new CcbError("CCB_RESULT_TOO_LARGE", "Local result exceeds the signed output limit.", { actualBytes: bytes.byteLength, maxBytes });
  }
  return value;
}

export function routeFiniteResult(decision: Extract<GatewayDecision, { kind: "result" }>, request: ProtectedRequest): IJson {
  let value: unknown;
  switch (decision.result.type) {
    case "status":
      value = decision.result.value;
      break;
    case "request-value":
      value = resolveJsonPointer(request, decision.result.jsonPointer);
      break;
    case "observation-value":
      if (!request.observation) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Decision references an observation that was not sent.");
      value = resolveJsonPointer(request.observation, decision.result.jsonPointer);
      break;
    default: {
      const exhaustive: never = decision.result;
      throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Unknown finite result selector.", { selector: String(exhaustive) });
    }
  }
  return enforceResultLimit(value, decision.limits.outputBytes);
}

export function routeExecutionResult(envelope: ExecutionEnvelope, execution: LocalExecutionResult): IJson {
  const maxBytes = envelope.limits.outputBytes;
  switch (envelope.return.mode) {
    case "command-result": {
      if (!execution.commandResults.has(envelope.return.commandId)) {
        throw new CcbError("CCB_INTERNAL", "Selected command result is unavailable.", { commandId: envelope.return.commandId });
      }
      return enforceResultLimit(execution.commandResults.get(envelope.return.commandId), maxBytes);
    }
    case "execution-summary":
      return enforceResultLimit(execution.summary, maxBytes);
    default: {
      const exhaustive: never = envelope.return;
      throw new CcbError("CCB_INTERNAL", "Unknown local result mode.", { mode: String(exhaustive) });
    }
  }
}
