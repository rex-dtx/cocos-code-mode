import type { KeyLike } from "node:crypto";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "../auth.ts";
import { CcbError } from "./errors.ts";
import { verifyReleaseMetadata, type SignedMetadata } from "./release-metadata.ts";
import type { CcBridgeStore } from "./store.ts";

const ReleaseTargetBodySchema = z.object({
  schemaVersion: z.literal(1),
  metadataVersion: z.number().int().positive(),
  releaseSequence: z.number().int().positive(),
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  package: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative().safe(),
    url: z.string(),
    packageManifestSha256: z.string(),
    sbomSha256: z.string(),
    provenanceSha256: z.string(),
  }).strict(),
  compatibility: z.object({
    protocol: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict(),
    creator: z.string().min(1),
    os: z.array(z.string().min(1)),
    arch: z.array(z.string().min(1)),
  }).strict(),
}).strict();

const RolloutPolicyBodySchema = z.object({
  schemaVersion: z.literal(1),
  policySequence: z.number().int().positive(),
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  targetPayloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  channel: z.string().min(1),
  ring: z.enum(["1", "3", "10"]),
  percentage: z.number().int().min(0).max(100),
  recommended: z.boolean(),
  minimumBuild: z.string().optional(),
  blockedBuilds: z.array(z.string()),
  rollbackTargetPayloadSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  disabledOperations: z.array(z.string()),
  emergencyStop: z.boolean(),
}).strict();

export interface ReleaseKeySet {
  targets: ReadonlyMap<string, KeyLike>;
  targetsThreshold: number;
  policy: ReadonlyMap<string, KeyLike>;
  policyThreshold: number;
}

export function loadReleaseKeySet(env: NodeJS.ProcessEnv = process.env): ReleaseKeySet | null {
  const targetsPem = env.CCB_RELEASE_TARGETS_PUBLIC_KEY_PEM;
  const policyPem = env.CCB_RELEASE_POLICY_PUBLIC_KEY_PEM;
  if (!targetsPem || !policyPem) return null;
  const targetsThreshold = Number(env.CCB_RELEASE_TARGETS_THRESHOLD ?? "1");
  const policyThreshold = Number(env.CCB_RELEASE_POLICY_THRESHOLD ?? "1");
  if (!Number.isSafeInteger(targetsThreshold) || targetsThreshold < 1 || !Number.isSafeInteger(policyThreshold) || policyThreshold < 1) {
    throw new Error("release key thresholds must be positive integers");
  }
  return {
    targets: new Map([[env.CCB_RELEASE_TARGETS_KEY_ID ?? "release-targets", createPublicKey(targetsPem)]]),
    targetsThreshold,
    policy: new Map([[env.CCB_RELEASE_POLICY_KEY_ID ?? "rollout-policy", createPublicKey(policyPem)]]),
    policyThreshold,
  };
}

function requireAdmin(auth: AuthContext): void {
  if (auth.role !== "admin") throw new CcbError("CCB_AUTH_INVALID", "Only an admin can manage releases.");
}

export function importReleaseTarget(store: CcBridgeStore, auth: AuthContext, wrapper: SignedMetadata, keys: ReleaseKeySet): { sequence: number; version: string; packageHash: string } {
  requireAdmin(auth);
  const body = ReleaseTargetBodySchema.parse(verifyReleaseMetadata("target", wrapper, keys.targets, keys.targetsThreshold));
  if (Date.parse(body.issuedAt) > Date.now() || Date.parse(body.expiresAt) <= Date.now()) {
    throw new CcbError("CCB_CANONICAL_INVALID", "Release target metadata is not currently valid.");
  }
  const existing = store.getReleaseTargetByHash(body.package.sha256);
  if (existing) throw new CcbError("CCB_REPLAY", "A release target with this package hash already exists.");
  const sequence = store.insertReleaseTarget({
    sequence: body.releaseSequence,
    version: body.package.version,
    packageHash: body.package.sha256,
    compatibility: body.compatibility,
    status: "active",
  });
  return { sequence, version: body.package.version, packageHash: body.package.sha256 };
}

export function publishRolloutPolicy(store: CcBridgeStore, auth: AuthContext, wrapper: SignedMetadata, keys: ReleaseKeySet): { sequence: number; policySequence: number } {
  requireAdmin(auth);
  const body = RolloutPolicyBodySchema.parse(verifyReleaseMetadata("policy", wrapper, keys.policy, keys.policyThreshold));
  if (Date.parse(body.issuedAt) > Date.now() || Date.parse(body.expiresAt) <= Date.now()) {
    throw new CcbError("CCB_CANONICAL_INVALID", "Rollout policy metadata is not currently valid.");
  }
  const latest = store.latestRolloutPolicySequence();
  if (body.policySequence <= latest) {
    throw new CcbError("CCB_REPLAY", "Rollout policy sequence must increase monotonically.", { latest, submitted: body.policySequence });
  }
  if (!store.getReleaseTargetByHash(body.targetPayloadSha256)) {
    throw new CcbError("CCB_DEVICE_DENIED", "Rollout policy references an unknown release target.");
  }
  const sequence = store.insertRolloutPolicy({
    sequence: body.policySequence,
    targetHash: body.targetPayloadSha256,
    channel: body.channel,
    ring: body.ring,
    percentage: body.percentage,
    minimumBuild: body.minimumBuild ?? null,
    blockedBuilds: body.blockedBuilds,
    rollbackTargetHash: body.rollbackTargetPayloadSha256[0] ?? null,
    expiresAtMs: Date.parse(body.expiresAt),
  });
  return { sequence, policySequence: body.policySequence };
}
