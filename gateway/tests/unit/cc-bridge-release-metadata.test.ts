import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signReleaseMetadata, verifyReleaseMetadata } from "../../src/cc-bridge/release-metadata.ts";

const keys = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "cc-bridge", "v1", "test-keys.json"), "utf8"));
const privateKey = createPrivateKey({ key: Buffer.from(keys.execution.privateKeyPkcs8, "base64url"), format: "der", type: "pkcs8" });
const publicKey = createPublicKey({ key: Buffer.from(keys.execution.publicKeySpki, "base64url"), format: "der", type: "spki" });

describe("CC Bridge release metadata", () => {
  it("verifies a threshold-1 target signature and rejects the wrong domain", () => {
    const body = { schemaVersion: 1, metadataVersion: 1, package: { sha256: "a".repeat(64), size: 1 } };
    const signed = signReleaseMetadata("target", "execution-fixture-1", body, privateKey);
    const keysById = new Map([["execution-fixture-1", publicKey]]);
    expect(verifyReleaseMetadata("target", signed, keysById, 1)).toEqual(body);
    expect(() => verifyReleaseMetadata("root", signed, keysById, 1)).toThrow("threshold not met");
  });
});
