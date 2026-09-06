import { KeyLike, verify as ed25519Verify } from "node:crypto";
import { ED25519_SIGNATURE_BYTES, assertKeyId, decodeBase64Url } from "../protected/protocol";

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
