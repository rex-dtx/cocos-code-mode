"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const { mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { acceptSignedReleaseSet, applySignedReleaseSet } = require("../../dist/update/metadata.js");
const { UpdateStateStore } = require("../../dist/update/state.js");

const PREFIX = {
  root: Buffer.from("CCB1 release-root\n"),
  target: Buffer.from("CCB1 release-targets\n"),
  policy: Buffer.from("CCB1 rollout-policy\n"),
};

function wrap(kind, keyId, body, privateKey) {
  const payload = Buffer.from(JSON.stringify(body));
  const signature = sign(null, Buffer.concat([PREFIX[kind], payload]), privateKey).toString("base64url");
  return { payload: payload.toString("base64url"), signatures: [{ keyId, signature }] };
}

function state() {
  return { schemaVersion: 1, highestRootVersion: 0, highestTargetSequence: 0, highestPolicySequence: 0 };
}

describe("signed release set acceptance", () => {
  const rootKeys = generateKeyPairSync("ed25519");
  const targetKeys = generateKeyPairSync("ed25519");
  const policyKeys = generateKeyPairSync("ed25519");
  const rootSpki = rootKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const targetSpki = targetKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const policySpki = policyKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const trusted = new Map([["root-1", rootKeys.publicKey]]);

  function fixtures() {
    const rootBody = {
      schemaVersion: 1,
      product: "cc-bridge-3x",
      rootVersion: 1,
      keys: {
        "root-1": { algorithm: "Ed25519", spkiDer: rootSpki },
        "targets-1": { algorithm: "Ed25519", spkiDer: targetSpki },
        "policy-1": { algorithm: "Ed25519", spkiDer: policySpki },
      },
      roles: {
        root: { keyIds: ["root-1"], threshold: 1 },
        targets: { keyIds: ["targets-1"], threshold: 1 },
        policy: { keyIds: ["policy-1"], threshold: 1 },
      },
    };
    const targetBody = { schemaVersion: 1, releaseSequence: 1, package: { name: "cc-bridge-3x" } };
    const target = wrap("target", "targets-1", targetBody, targetKeys.privateKey);
    const digest = createHash("sha256").update(Buffer.from(target.payload, "base64url")).digest("hex");
    const policy = wrap("policy", "policy-1", { schemaVersion: 1, policySequence: 1, targetPayloadSha256: digest, ring: "1" }, policyKeys.privateKey);
    const root = wrap("root", "root-1", rootBody, rootKeys.privateKey);
    return { root, target, policy, digest };
  }

  it("accepts a threshold-signed root/target/policy set and advances monotonic state", () => {
    const set = fixtures();
    const accepted = acceptSignedReleaseSet({
      ...set,
      trustedRootKeys: trusted,
      rootThreshold: 1,
      state: state(),
    });
    assert.deepEqual(accepted.nextState, {
      schemaVersion: 1,
      highestRootVersion: 1,
      highestTargetSequence: 1,
      highestPolicySequence: 1,
    });
  });

  it("rejects a policy bound to a different target digest", () => {
    const set = fixtures();
    set.policy = wrap("policy", "policy-1", {
      schemaVersion: 1,
      policySequence: 1,
      targetPayloadSha256: "a".repeat(64),
      ring: "1",
    }, policyKeys.privateKey);
    assert.throws(() => acceptSignedReleaseSet({
      ...set,
      trustedRootKeys: trusted,
      rootThreshold: 1,
      state: state(),
    }), /digest mismatch/);
  });

  it("persists accepted sequences and refuses a lower root version", () => {
    mkdirSync(join(homedir(), ".cc-bridge"), { recursive: true });
    const dir = mkdtempSync(join(homedir(), ".cc-bridge", "update-chain-"));
    try {
      const store = new UpdateStateStore(join(dir, "update-state-v1.json"));
      const set = fixtures();
      const persisted = applySignedReleaseSet(store, {
        root: set.root,
        target: set.target,
        policy: set.policy,
        trustedRootKeys: trusted,
        rootThreshold: 1,
      });
      assert.equal(persisted.highestPolicySequence, 1);
      assert.equal(store.load().highestTargetSequence, 1);
      const lower = fixtures();
      // Re-sign a rootVersion 0 body with the trusted root key.
      const rootBody = JSON.parse(Buffer.from(lower.root.payload, "base64url").toString("utf8"));
      rootBody.rootVersion = 0;
      lower.root = wrap("root", "root-1", rootBody, rootKeys.privateKey);
      assert.throws(() => applySignedReleaseSet(store, {
        root: lower.root,
        target: lower.target,
        policy: lower.policy,
        trustedRootKeys: trusted,
        rootThreshold: 1,
      }), /rolled back/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
