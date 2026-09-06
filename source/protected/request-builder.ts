import { KeyLike, randomBytes } from "crypto";
import { assertIJson, canonicalizeToBytes, IJson } from "./canonical-json";
import {
  OBSERVATION_MAX_BYTES, ProtectedRequest, SignedProtectedRequest, signProtectedRequest,
} from "./protocol";
import { parseProtectedRequest } from "./schemas";
import type { CompletionTelemetry } from "./protocol";
import { encodeBase64Url, randomUUID } from "./node14-compat";

export interface ToolRequestBinding {
  id: string;
  contractVersion: number;
  contractHash: string;
}

export interface RelayRequestBinding {
  build: string;
  packageHash: string;
  creatorVersion: string;
  os: string;
}

export interface ProtectedObservation {
  contractId: string;
  consentVersion: string;
  revisionToken: string;
  digest: string;
  fields: IJson;
}

export interface BuildProtectedRequestOptions {
  deviceKeyId: string;
  deviceId: string;
  projectId: string;
  relayInstanceId: string;
  sequence: number;
  tool: ToolRequestBinding;
  relay: RelayRequestBinding;
  inputs: IJson;
  observation?: ProtectedObservation;
  priorTelemetry?: CompletionTelemetry[];
  idempotencyKey?: string;
  nowMs?: number;
  privateKey: KeyLike;
}

export interface BuiltProtectedRequest {
  request: ProtectedRequest;
  signed: SignedProtectedRequest;
  wrapperBytes: Buffer;
}

export function buildProtectedRequest(options: BuildProtectedRequestOptions): BuiltProtectedRequest {
  const nowMs = options.nowMs ?? Date.now();
  assertIJson(options.inputs);
  if (options.observation) {
    assertIJson(options.observation.fields);
    const observationBytes = canonicalizeToBytes(options.observation);
    if (observationBytes.byteLength > OBSERVATION_MAX_BYTES) {
      throw new RangeError(`observation exceeds ${OBSERVATION_MAX_BYTES} bytes`);
    }
  }

  const request: ProtectedRequest = {
    protocolVersion: 1,
    requestId: randomUUID(),
    idempotencyKey: options.idempotencyKey ?? encodeBase64Url(randomBytes(24)),
    deviceId: options.deviceId,
    projectId: options.projectId,
    relayInstanceId: options.relayInstanceId,
    sequence: options.sequence,
    issuedAtMs: nowMs,
    nonce: encodeBase64Url(randomBytes(16)),
    tool: { ...options.tool },
    relay: { ...options.relay },
    inputs: options.inputs,
    ...(options.observation ? { observation: options.observation } : {}),
    ...(options.priorTelemetry && options.priorTelemetry.length > 0 ? { priorTelemetry: options.priorTelemetry } : {}),
  };
  parseProtectedRequest(request, nowMs);
  const signed = signProtectedRequest(options.deviceKeyId, request, options.privateKey);
  return { request, signed, wrapperBytes: canonicalizeToBytes(signed) };
}
