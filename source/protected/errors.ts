export const CCB_ERROR_CODES = [
  "CCB_AUTH_REQUIRED", "CCB_AUTH_INVALID", "CCB_PRODUCT_DENIED", "CCB_DEVICE_DENIED",
  "CCB_PROJECT_DENIED", "CCB_CONTRACT_MISMATCH", "CCB_PRECONDITION_FAILED",
  "CCB_BUILD_INCOMPATIBLE", "CCB_CREATOR_INCOMPATIBLE", "CCB_CANONICAL_INVALID",
  "CCB_SIGNATURE_INVALID", "CCB_EXPIRED", "CCB_REPLAY", "CCB_IDEMPOTENCY_CONFLICT",
  "CCB_LIMIT_EXCEEDED", "CCB_PRIMITIVE_UNKNOWN", "CCB_VALUE_PROVENANCE_INVALID",
  "CCB_PARTIAL_EXECUTION", "CCB_RESULT_TOO_LARGE", "CCB_GATEWAY_UNAVAILABLE",
  "CCB_OUTCOME_UNKNOWN", "CCB_BUSY", "CCB_INTERNAL",
] as const;
export type CcbErrorCode = typeof CCB_ERROR_CODES[number];

export interface CcbErrorBody {
  error: string;
  code: CcbErrorCode;
  details: Record<string, null | boolean | number | string>;
  recovery: string;
}

const RECOVERY_BY_CODE: Record<CcbErrorCode, string> = {
  CCB_AUTH_REQUIRED: "Configure a valid member credential and retry.",
  CCB_AUTH_INVALID: "Re-authenticate, then retry with a newly issued credential.",
  CCB_PRODUCT_DENIED: "Ask an administrator to grant the cc_bridge product.",
  CCB_DEVICE_DENIED: "Re-enroll this device or ask an administrator to approve it.",
  CCB_PROJECT_DENIED: "Ask an administrator to grant this opaque project ID.",
  CCB_CONTRACT_MISMATCH: "Install a compatible signed relay build.",
  CCB_PRECONDITION_FAILED: "Refresh project state and submit a new operation.",
  CCB_BUILD_INCOMPATIBLE: "Install the current permitted signed relay build.",
  CCB_CREATOR_INCOMPATIBLE: "Use a supported Creator version or compatible relay.",
  CCB_CANONICAL_INVALID: "Regenerate the request with the public protocol library.",
  CCB_SIGNATURE_INVALID: "Discard the message and re-establish trusted key state.",
  CCB_EXPIRED: "Create a fresh request after synchronizing system time.",
  CCB_REPLAY: "Create a fresh request; do not reuse nonce or sequence.",
  CCB_IDEMPOTENCY_CONFLICT: "Use a new idempotency key for changed request bytes.",
  CCB_LIMIT_EXCEEDED: "Reduce the bounded request or operation size.",
  CCB_PRIMITIVE_UNKNOWN: "Install a relay compatible with this contract version.",
  CCB_VALUE_PROVENANCE_INVALID: "Use only request, observation, or public contract values.",
  CCB_PARTIAL_EXECUTION: "Inspect the reported commands and use Creator undo or reconcile state.",
  CCB_RESULT_TOO_LARGE: "Use the authenticated local artifact result path.",
  CCB_GATEWAY_UNAVAILABLE: "Restore Gateway connectivity; protected tools do not run offline.",
  CCB_OUTCOME_UNKNOWN: "Reconcile Creator state before issuing any replacement mutation.",
  CCB_BUSY: "Retry after the bounded queue delay using the exact same request bytes.",
  CCB_INTERNAL: "Report the correlation ID; do not retry an effectful call blindly.",
};

export class CcbError extends Error {
  readonly body: CcbErrorBody;

  constructor(code: CcbErrorCode, error: string, details: CcbErrorBody["details"] = {}, recovery = RECOVERY_BY_CODE[code]) {
    super(error);
    this.name = "CcbError";
    this.body = { error, code, details, recovery };
  }
}

export function toCcbErrorBody(error: unknown): CcbErrorBody {
  if (error instanceof CcbError) return error.body;
  return { error: "CC Bridge operation failed.", code: "CCB_INTERNAL", details: {}, recovery: RECOVERY_BY_CODE.CCB_INTERNAL };
}
