import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { CcbError } from "./errors.ts";
import { ED25519_SPKI_DER_BYTES, KEY_ID_PATTERN, decodeBase64Url } from "./protocol.ts";
import type { CcBridgeStore } from "./store.ts";

const EnrollSchema = z.object({
  deviceKeyId: z.string().regex(KEY_ID_PATTERN),
  publicKeySpki: z.string().min(1).max(128),
  label: z.string().min(1).max(64),
}).strict();

export function enrollDevice(store: CcBridgeStore, auth: AuthContext, body: unknown, nowMs = Date.now()) {
  if (auth.is_legacy || auth.tokenAlg !== "EdDSA") {
    throw new CcbError("CCB_AUTH_INVALID", "Device enrollment requires an EdDSA member JWT.");
  }
  const parsed = EnrollSchema.parse(body);
  const publicKeySpki = decodeBase64Url(parsed.publicKeySpki, ED25519_SPKI_DER_BYTES, ED25519_SPKI_DER_BYTES);
  const fingerprint = createHash("sha256").update(publicKeySpki).digest("hex").slice(0, 32);
  const deviceId = randomUUID();
  store.insertDevice({
    id: deviceId,
    keyId: parsed.deviceKeyId,
    memberId: auth.member_id,
    publicKeySpki,
    fingerprint,
    label: parsed.label,
    status: "pending",
  }, nowMs);
  return { deviceId, fingerprint, status: "pending" as const };
}

export function approveEnrolledDevice(store: CcBridgeStore, auth: AuthContext, deviceId: string, nowMs = Date.now()) {
  if (auth.role !== "admin") throw new CcbError("CCB_AUTH_INVALID", "Only an admin can approve a device.");
  if (!z.string().uuid().safeParse(deviceId).success) throw new CcbError("CCB_CANONICAL_INVALID", "Device ID is not a UUID.");
  if (!store.approveDevice(deviceId, nowMs)) throw new CcbError("CCB_DEVICE_DENIED", "Device is not pending approval.");
  return { deviceId, status: "approved" as const };
}

const GrantSchema = z.object({
  memberId: z.string().min(1).max(128).nullable().optional(),
  deviceId: z.string().uuid().nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  toolId: z.string().min(1).max(128).nullable().optional(),
  operationClass: z.enum(["read", "mutation", "capture", "control"]),
  expiresAtMs: z.number().int().positive().nullable().optional(),
}).strict();

function requireAdmin(auth: AuthContext): void {
  if (auth.role !== "admin") throw new CcbError("CCB_AUTH_INVALID", "Only an admin can manage devices and grants.");
}

export function listAdminDevices(store: CcBridgeStore, auth: AuthContext) {
  requireAdmin(auth);
  return { devices: store.listDevices().map(({ publicKeySpki, ...rest }) => rest) };
}

export function revokeEnrolledDevice(store: CcBridgeStore, auth: AuthContext, deviceId: string, nowMs = Date.now()) {
  requireAdmin(auth);
  if (!z.string().uuid().safeParse(deviceId).success) throw new CcbError("CCB_CANONICAL_INVALID", "Device ID is not a UUID.");
  if (!store.revokeDevice(deviceId, nowMs)) throw new CcbError("CCB_DEVICE_DENIED", "Device is already revoked or missing.");
  return { deviceId, status: "revoked" as const };
}

export function createGrant(store: CcBridgeStore, auth: AuthContext, body: unknown, nowMs = Date.now()) {
  requireAdmin(auth);
  const parsed = GrantSchema.parse(body);
  const id = randomUUID();
  store.insertGrant({
    id,
    memberId: parsed.memberId ?? null,
    deviceId: parsed.deviceId ?? null,
    projectId: parsed.projectId ?? null,
    toolId: parsed.toolId ?? null,
    operationClass: parsed.operationClass,
    expiresAtMs: parsed.expiresAtMs ?? null,
    status: "active",
  }, nowMs);
  return { grantId: id, status: "active" as const };
}

export function listAdminGrants(store: CcBridgeStore, auth: AuthContext) {
  requireAdmin(auth);
  return { grants: store.listGrants() };
}

export function revokeAdminGrant(store: CcBridgeStore, auth: AuthContext, grantId: string) {
  requireAdmin(auth);
  if (!z.string().uuid().safeParse(grantId).success) throw new CcbError("CCB_CANONICAL_INVALID", "Grant ID is not a UUID.");
  if (!store.revokeGrant(grantId)) throw new CcbError("CCB_DEVICE_DENIED", "Grant is already revoked or missing.");
  return { grantId, status: "revoked" as const };
}
