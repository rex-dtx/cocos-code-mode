import { createHash } from "node:crypto";
import { assertIJson, canonicalizeToBytes, IJson } from "./canonical-json";
import { CcbError } from "./errors";
import { OBSERVATION_MAX_BYTES } from "./protocol";
import type { ProtectedObservation } from "./request-builder";

export interface ObservationSpec {
  contractId: string;
  consentVersion: string;
  revisionToken: string;
  fields: readonly string[];
}

export type FieldCollector = (field: string) => IJson;

export function collectObservation(spec: ObservationSpec, collectField: FieldCollector): ProtectedObservation {
  const fields: Record<string, IJson> = {};
  for (const field of spec.fields) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) {
      throw new CcbError("CCB_CONTRACT_MISMATCH", "Observation field is not a public contract identifier.", { field });
    }
    fields[field] = collectField(field);
  }
  assertIJson(fields);
  const observation: ProtectedObservation = {
    contractId: spec.contractId,
    consentVersion: spec.consentVersion,
    revisionToken: spec.revisionToken,
    digest: createHash("sha256").update(canonicalizeToBytes(fields)).digest("hex"),
    fields,
  };
  const bytes = canonicalizeToBytes(observation);
  if (bytes.byteLength > OBSERVATION_MAX_BYTES) {
    throw new CcbError("CCB_LIMIT_EXCEEDED", "Observation exceeds the public contract byte cap.", { bytes: bytes.byteLength });
  }
  return observation;
}
