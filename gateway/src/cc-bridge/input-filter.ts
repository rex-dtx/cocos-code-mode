import { CcbError } from "./errors.ts";
import type { ProtectedRequest } from "./protocol.ts";
import { ALLOWED_INPUTS } from "./tool-catalog.ts";

export function filterProtectedInputs(request: ProtectedRequest): ProtectedRequest {
  const allowed = ALLOWED_INPUTS[request.tool.id];
  if (!allowed) throw new CcbError("CCB_CONTRACT_MISMATCH", "Tool has no executable input contract.", { tool: request.tool.id });
  const inputs = request.inputs;
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Protected inputs must be a bounded object.");
  }
  for (const key of Object.keys(inputs)) {
    if (!allowed.has(key)) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Request contains an unapproved input field.", { field: key });
  }
  return request;
}
