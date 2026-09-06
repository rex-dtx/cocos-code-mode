import { createHash, createPublicKey, type KeyLike, verify as ed25519Verify } from "node:crypto";
import { ED25519_SIGNATURE_BYTES, assertKeyId, decodeBase64Url } from "../protected/protocol";
import { UpdateStateStore, type UpdateState } from "./state";

export interface MetadataSignature {
  keyId: string;
  signature: string;
}

export interface SignedMetadata {
  payload: string;
  signatures: MetadataSignature[];
}

const PREFIX = {
  root: Buffer.from("CCB1 release-root\n", "utf8"),
  target: Buffer.from("CCB1 release-targets\n", "utf8"),
  policy: Buffer.from("CCB1 rollout-policy\n", "utf8"),
} as const;

export function verifyReleaseMetadata(
  kind: keyof typeof PREFIX,
  wrapper: SignedMetadata,
  keys: ReadonlyMap<string, KeyLike>,
  threshold: number,
): unknown {
  const payload = decodeBase64Url(wrapper.payload, 256 * 1024);
  const message = Buffer.concat([PREFIX[kind], payload]);
  const seen = new Set<string>();
  let accepted = 0;
  for (const entry of wrapper.signatures) {
    assertKeyId(entry.keyId);
    if (seen.has(entry.keyId)) continue;
    seen.add(entry.keyId);
    const key = keys.get(entry.keyId);
    if (!key) continue;
    const signature = decodeBase64Url(entry.signature, ED25519_SIGNATURE_BYTES, ED25519_SIGNATURE_BYTES);
    if (ed25519Verify(null, message, key, signature)) accepted += 1;
  }
  if (accepted < threshold) throw new Error("release metadata signature threshold not met");
  return JSON.parse(Buffer.from(payload).toString("utf8"));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function roleKeySet(root: { keys: Record<string, { algorithm: string; spkiDer: string }>; roles: Record<string, { keyIds: string[]; threshold: number }> }, role: "targets" | "policy"): { keys: Map<string, KeyLike>; threshold: number } {
  const spec = root.roles[role];
  if (!spec || spec.threshold < 1) throw new Error(`root is missing ${role} role`);
  const keys = new Map<string, KeyLike>();
  for (const keyId of spec.keyIds) {
    const entry = root.keys[keyId];
    if (!entry || entry.algorithm !== "Ed25519") throw new Error(`root is missing ${role} key ${keyId}`);
    keys.set(keyId, createPublicKey({ key: Buffer.from(entry.spkiDer, "base64url"), format: "der", type: "spki" }));
  }
  return { keys, threshold: spec.threshold };
}

export function acceptSignedReleaseSet(input: {
  root: SignedMetadata;
  target: SignedMetadata;
  policy: SignedMetadata;
  trustedRootKeys: ReadonlyMap<string, KeyLike>;
  rootThreshold: number;
  state: UpdateState;
}): { nextState: UpdateState } {
  const root = verifyReleaseMetadata("root", input.root, input.trustedRootKeys, input.rootThreshold) as {
    rootVersion: number;
    keys: Record<string, { algorithm: string; spkiDer: string }>;
    roles: Record<string, { keyIds: string[]; threshold: number }>;
  };
  if (!Number.isInteger(root.rootVersion) || root.rootVersion < input.state.highestRootVersion) {
    throw new Error("root version rolled back");
  }
  const targets = roleKeySet(root, "targets");
  const policies = roleKeySet(root, "policy");
  const target = verifyReleaseMetadata("target", input.target, targets.keys, targets.threshold) as { releaseSequence: number };
  if (!Number.isInteger(target.releaseSequence) || target.releaseSequence < input.state.highestTargetSequence) {
    throw new Error("target sequence rolled back");
  }
  const policy = verifyReleaseMetadata("policy", input.policy, policies.keys, policies.threshold) as {
    policySequence: number;
    targetPayloadSha256: string;
  };
  if (!Number.isInteger(policy.policySequence) || policy.policySequence < input.state.highestPolicySequence) {
    throw new Error("policy sequence rolled back");
  }
  const targetPayload = decodeBase64Url(input.target.payload, 256 * 1024);
  if (policy.targetPayloadSha256 !== sha256Hex(targetPayload)) throw new Error("policy/target digest mismatch");
  return {
    nextState: {
      schemaVersion: 1,
      highestRootVersion: Math.max(input.state.highestRootVersion, root.rootVersion),
      highestTargetSequence: Math.max(input.state.highestTargetSequence, target.releaseSequence),
      highestPolicySequence: Math.max(input.state.highestPolicySequence, policy.policySequence),
    },
  };
}

export function applySignedReleaseSet(
  store: UpdateStateStore,
  input: Omit<Parameters<typeof acceptSignedReleaseSet>[0], "state">,
): UpdateState {
  const accepted = acceptSignedReleaseSet({ ...input, state: store.load() });
  return store.persistIfMonotonic(accepted.nextState);
}
