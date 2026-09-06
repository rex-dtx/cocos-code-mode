import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth.ts";
import { importReleaseTarget, publishRolloutPolicy } from "../../src/cc-bridge/release-admin.ts";
import { signReleaseMetadata } from "../../src/cc-bridge/release-metadata.ts";
import { CcBridgeStore } from "../../src/cc-bridge/store.ts";

const admin: AuthContext = {
  member_id: "member-1",
  label: "fixture",
  jti: "jti-1",
  is_legacy: false,
  clearance: "restricted",
  products: ["cc_bridge"],
  tokenAlg: "EdDSA",
  role: "admin",
  exp: 2_000_000_000,
};

const searcher: AuthContext = { ...admin, role: "searcher" };

function targetBody(sha256 = "a".repeat(64)) {
  return {
    schemaVersion: 1,
    metadataVersion: 1,
    releaseSequence: 1,
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    package: {
      name: "cc-bridge-3x",
      version: "2.0.0",
      sha256,
      size: 100,
      url: "",
      packageManifestSha256: "b".repeat(64),
      sbomSha256: "",
      provenanceSha256: "",
    },
    compatibility: {
      protocol: { min: 1, max: 1 },
      creator: ">=3.7.0",
      os: ["win32"],
      arch: ["x64"],
    },
  };
}

function policyBody(targetHash: string, sequence = 1, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    policySequence: sequence,
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    targetPayloadSha256: targetHash,
    channel: "stable",
    ring: "1",
    percentage: 100,
    recommended: true,
    blockedBuilds: [],
    rollbackTargetPayloadSha256: [],
    disabledOperations: [],
    emergencyStop: false,
    ...overrides,
  };
}

describe("CC Bridge release admin", () => {
  const targetKeys = generateKeyPairSync("ed25519");
  const policyKeys = generateKeyPairSync("ed25519");
  const keys = {
    targets: new Map([["targets-fixture-1", targetKeys.publicKey]]),
    targetsThreshold: 1,
    policy: new Map([["policy-fixture-1", policyKeys.publicKey]]),
    policyThreshold: 1,
  };
  const targetPrivateKey = targetKeys.privateKey;
  const policyPrivateKey = policyKeys.privateKey;

  it("imports a signed target and publishes a signed policy referencing it", () => {
    const store = new CcBridgeStore(":memory:");
    const targetHash = "a".repeat(64);
    const imported = importReleaseTarget(store, admin, signReleaseMetadata("target", "targets-fixture-1", targetBody(targetHash), targetPrivateKey), keys);
    expect(imported.packageHash).toBe(targetHash);
    expect(store.listReleaseTargets()).toHaveLength(1);

    const published = publishRolloutPolicy(store, admin, signReleaseMetadata("policy", "policy-fixture-1", policyBody(targetHash, 1), policyPrivateKey), keys);
    expect(published.policySequence).toBe(1);
    expect(store.listRolloutPolicies()).toHaveLength(1);
  });

  it("rejects a policy with a non-increasing sequence", () => {
    const store = new CcBridgeStore(":memory:");
    const targetHash = "a".repeat(64);
    importReleaseTarget(store, admin, signReleaseMetadata("target", "targets-fixture-1", targetBody(targetHash), targetPrivateKey), keys);
    publishRolloutPolicy(store, admin, signReleaseMetadata("policy", "policy-fixture-1", policyBody(targetHash, 5), policyPrivateKey), keys);
    expect(() => publishRolloutPolicy(store, admin, signReleaseMetadata("policy", "policy-fixture-1", policyBody(targetHash, 5), policyPrivateKey), keys)).toThrow(/monotonically/);
    expect(() => publishRolloutPolicy(store, admin, signReleaseMetadata("policy", "policy-fixture-1", policyBody(targetHash, 3), policyPrivateKey), keys)).toThrow(/monotonically/);
  });

  it("rejects a policy referencing an unknown target", () => {
    const store = new CcBridgeStore(":memory:");
    expect(() => publishRolloutPolicy(store, admin, signReleaseMetadata("policy", "policy-fixture-1", policyBody("c".repeat(64), 1), policyPrivateKey), keys)).toThrow(/unknown release target/);
  });

  it("rejects a target signed by the wrong key role", () => {
    const store = new CcBridgeStore(":memory:");
    // Signed with the policy key over the target domain -> targets threshold not met.
    expect(() => importReleaseTarget(store, admin, signReleaseMetadata("target", "policy-fixture-1", targetBody(), policyPrivateKey), keys)).toThrow();
  });

  it("rejects non-admin mutation", () => {
    const store = new CcBridgeStore(":memory:");
    expect(() => importReleaseTarget(store, searcher, signReleaseMetadata("target", "targets-fixture-1", targetBody(), targetPrivateKey), keys)).toThrow(/admin/);
  });
});
