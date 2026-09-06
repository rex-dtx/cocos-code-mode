import { verify as ed25519Verify } from "node:crypto";
import type { KeyLike } from "node:crypto";
import { z } from "zod";
import { parseCanonicalJson } from "../protected/canonical-json";
import { CcbError } from "../protected/errors";
import { ED25519_SIGNATURE_BYTES, assertKeyId, decodeBase64Url } from "../protected/protocol";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const IsoSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, "must be an exact ISO timestamp");
const KeyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

const SignatureSchema = z.object({
  keyId: KeyIdSchema,
  signature: z.string().regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export const SignedMetadataSchema = z.object({
  payload: z.string().regex(/^[A-Za-z0-9_-]+$/),
  signatures: z.array(SignatureSchema).min(1).max(16),
}).strict();
export type SignedMetadata = z.infer<typeof SignedMetadataSchema>;

const RoleSchema = z.object({ keyIds: z.array(KeyIdSchema).min(1), threshold: z.number().int().positive() }).strict();
export const RootBodySchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("cc-bridge-3x"),
  rootVersion: z.number().int().positive(),
  issuedAt: IsoSchema,
  expiresAt: IsoSchema,
  keys: z.record(z.object({ algorithm: z.literal("Ed25519"), spkiDer: z.string().regex(/^[A-Za-z0-9_-]+$/) }).strict()),
  roles: z.object({ root: RoleSchema, targets: RoleSchema, policy: RoleSchema }).strict(),
}).strict();
export type RootBody = z.infer<typeof RootBodySchema>;

export const ReleaseTargetBodySchema = z.object({
  schemaVersion: z.literal(1),
  metadataVersion: z.number().int().positive(),
  releaseSequence: z.number().int().positive(),
  issuedAt: IsoSchema,
  expiresAt: IsoSchema,
  package: z.object({
    name: z.literal("cc-bridge-3x"),
    version: z.string().min(1).max(128),
    sha256: Sha256Schema,
    size: z.number().int().positive().safe(),
    url: z.string().url().refine((value) => value.startsWith("https://"), "must use HTTPS"),
    packageManifestSha256: Sha256Schema,
    sbomSha256: Sha256Schema,
    provenanceSha256: Sha256Schema,
  }).strict(),
  compatibility: z.object({
    protocol: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict(),
    creator: z.string().min(1).max(128),
    os: z.array(z.string().min(1).max(32)).min(1).max(16),
    arch: z.array(z.string().min(1).max(32)).min(1).max(16),
  }).strict(),
}).strict();
export type ReleaseTargetBody = z.infer<typeof ReleaseTargetBodySchema>;

export const RolloutPolicyBodySchema = z.object({
  schemaVersion: z.literal(1),
  policySequence: z.number().int().positive(),
  issuedAt: IsoSchema,
  expiresAt: IsoSchema,
  targetPayloadSha256: Sha256Schema,
  channel: z.string().min(1).max(64),
  ring: z.enum(["1", "3", "10"]),
  percentage: z.number().int().min(0).max(100),
  recommended: z.boolean(),
  minimumBuild: z.string().min(1).max(128).optional(),
  blockedBuilds: z.array(z.string().min(1).max(128)).max(1024),
  rollbackTargetPayloadSha256: z.array(Sha256Schema).max(8),
  disabledOperations: z.array(z.string().min(1).max(128)).max(1024),
  emergencyStop: z.boolean(),
}).strict();
export type RolloutPolicyBody = z.infer<typeof RolloutPolicyBodySchema>;

const PREFIX = {
  root: Buffer.from("CCB1 release-root\n", "utf8"),
  target: Buffer.from("CCB1 release-targets\n", "utf8"),
  policy: Buffer.from("CCB1 rollout-policy\n", "utf8"),
} as const;
const BODY_SCHEMA = { root: RootBodySchema, target: ReleaseTargetBodySchema, policy: RolloutPolicyBodySchema } as const;
export type ReleaseMetadataKind = keyof typeof PREFIX;
export type ReleaseMetadataBody<K extends ReleaseMetadataKind> = K extends "root" ? RootBody : K extends "target" ? ReleaseTargetBody : RolloutPolicyBody;

function fail(code: "CCB_CANONICAL_INVALID" | "CCB_SIGNATURE_INVALID", message: string): never {
  throw new CcbError(code, message);
}

export function verifyReleaseMetadata<K extends ReleaseMetadataKind>(
  kind: K,
  input: unknown,
  keys: ReadonlyMap<string, KeyLike>,
  threshold: number,
): ReleaseMetadataBody<K> {
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > keys.size) {
    fail("CCB_SIGNATURE_INVALID", "Release metadata signature threshold is invalid.");
  }
  let wrapper: SignedMetadata;
  try { wrapper = SignedMetadataSchema.parse(input); }
  catch { fail("CCB_CANONICAL_INVALID", "Release metadata wrapper is invalid."); }

  let payload: Buffer;
  try { payload = decodeBase64Url(wrapper.payload, 256 * 1024); }
  catch { fail("CCB_CANONICAL_INVALID", "Release metadata payload encoding is invalid."); }
  const message = Buffer.concat([PREFIX[kind], payload]);
  const seen = new Set<string>();
  let accepted = 0;
  for (const entry of wrapper.signatures) {
    try { assertKeyId(entry.keyId); }
    catch { fail("CCB_CANONICAL_INVALID", "Release metadata key ID is invalid."); }
    if (seen.has(entry.keyId)) fail("CCB_SIGNATURE_INVALID", "Release metadata contains a duplicate signature key.");
    seen.add(entry.keyId);
    const key = keys.get(entry.keyId);
    if (!key) fail("CCB_SIGNATURE_INVALID", "Release metadata contains an unknown signature key.");
    let signature: Buffer;
    try { signature = decodeBase64Url(entry.signature, ED25519_SIGNATURE_BYTES, ED25519_SIGNATURE_BYTES); }
    catch { fail("CCB_SIGNATURE_INVALID", "Release metadata signature encoding is invalid."); }
    if (!ed25519Verify(null, message, key, signature)) fail("CCB_SIGNATURE_INVALID", "Release metadata signature is invalid.");
    accepted += 1;
  }
  if (accepted < threshold) fail("CCB_SIGNATURE_INVALID", "Release metadata signature threshold not met.");

  let parsed: unknown;
  try { parsed = parseCanonicalJson(payload, 256 * 1024); }
  catch { fail("CCB_CANONICAL_INVALID", "Release metadata payload is not canonical RFC 8785 I-JSON."); }
  try { return BODY_SCHEMA[kind].parse(parsed) as ReleaseMetadataBody<K>; }
  catch { fail("CCB_CANONICAL_INVALID", `Release ${kind} metadata body is invalid.`); }
}
