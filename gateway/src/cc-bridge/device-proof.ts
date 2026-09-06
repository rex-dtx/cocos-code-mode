import { createPublicKey } from "node:crypto";
import { CcbError } from "./errors.ts";
import { WRAPPER_MAX_BYTES, verifyProtectedRequest } from "./protocol.ts";
import { parseProtectedRequest, parseSignedProtectedRequest } from "./schemas.ts";
import type { CcBridgeStore, DeviceRecord } from "./store.ts";
import type { ProtectedRequest, SignedProtectedRequest } from "./protocol.ts";

export interface VerifiedDeviceRequest {
  wrapper: SignedProtectedRequest;
  request: ProtectedRequest;
  device: DeviceRecord;
  payloadBytes: Buffer;
}

export function verifyDeviceRequest(store: CcBridgeStore, rawBody: Buffer, nowMs = Date.now()): VerifiedDeviceRequest {
  if (rawBody.byteLength === 0 || rawBody.byteLength > WRAPPER_MAX_BYTES) {
    throw new CcbError("CCB_LIMIT_EXCEEDED", "Signed request wrapper exceeds the wire cap.", { bytes: rawBody.byteLength });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new CcbError("CCB_CANONICAL_INVALID", "Signed request wrapper is not JSON.");
  }
  let wrapper: SignedProtectedRequest;
  try {
    wrapper = parseSignedProtectedRequest(parsed);
  } catch {
    throw new CcbError("CCB_CANONICAL_INVALID", "Signed request wrapper failed schema checks.");
  }
  const device = store.getDeviceByKeyId(wrapper.deviceKeyId);
  if (!device || device.status !== "approved") {
    throw new CcbError("CCB_DEVICE_DENIED", "Device key is unknown, pending, or revoked.");
  }
  let canonical: unknown;
  try {
    canonical = verifyProtectedRequest(wrapper, createPublicKey({ key: device.publicKeySpki, format: "der", type: "spki" }));
  } catch {
    throw new CcbError("CCB_SIGNATURE_INVALID", "Device signature did not verify.");
  }
  let request: ProtectedRequest;
  try {
    request = parseProtectedRequest(canonical, nowMs);
  } catch (error) {
    if (error instanceof RangeError) throw new CcbError("CCB_EXPIRED", error.message);
    throw new CcbError("CCB_CANONICAL_INVALID", "Protected request failed schema or freshness checks.");
  }
  if (request.deviceId !== device.id) {
    throw new CcbError("CCB_DEVICE_DENIED", "Request device ID does not match the signed key.");
  }
  return { wrapper, request, device, payloadBytes: Buffer.from(wrapper.payload, "base64url") };
}
