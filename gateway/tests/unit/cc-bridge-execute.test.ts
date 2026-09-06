import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth.ts";
import { canonicalizeToBytes } from "../../src/cc-bridge/canonical-json.ts";
import { MemoryEnvelopeSigner } from "../../src/cc-bridge/envelope-signer.ts";
import { executeProtectedTool } from "../../src/cc-bridge/execute-service.ts";
import { planCreateUiNode } from "../../src/cc-bridge/planners/create-ui-node.ts";
import { ProtectedToolRegistry } from "../../src/cc-bridge/protected-tool-registry.ts";
import { ReplayStore } from "../../src/cc-bridge/replay-store.ts";
import { parseGatewayDecision, parseSignedGatewayDecision } from "../../src/cc-bridge/schemas.ts";
import { CcBridgeStore } from "../../src/cc-bridge/store.ts";
import { verifyGatewayDecision } from "../../src/cc-bridge/protocol.ts";

const fixtureRoot = join(import.meta.dirname, "..", "fixtures", "cc-bridge", "v1");
const keys = JSON.parse(readFileSync(join(fixtureRoot, "test-keys.json"), "utf8"));
const vectors = JSON.parse(readFileSync(join(fixtureRoot, "vectors.json"), "utf8"));
const executionPrivateKey = createPrivateKey({ key: Buffer.from(keys.execution.privateKeyPkcs8, "base64url"), format: "der", type: "pkcs8" });
const executionPublicKey = createPublicKey({ key: Buffer.from(keys.execution.publicKeySpki, "base64url"), format: "der", type: "spki" });

const auth: AuthContext = {
  member_id: "member-1",
  label: "fixture",
  jti: "jti-1",
  is_legacy: false,
  clearance: "internal",
  products: ["cc_bridge"],
  tokenAlg: "EdDSA",
};

function runtime() {
  const store = new CcBridgeStore(":memory:");
  store.insertDevice({
    id: vectors.request.deviceId,
    keyId: vectors.signedRequest.deviceKeyId,
    memberId: auth.member_id,
    publicKeySpki: Buffer.from(keys.device.publicKeySpki, "base64url"),
    fingerprint: "fixture-device",
    label: "fixture",
    status: "approved",
  });
  store.insertProject({ id: vectors.request.projectId, displayLabel: "fixture", status: "active" });
  store.insertGrant({
    id: "grant-1",
    memberId: auth.member_id,
    deviceId: vectors.request.deviceId,
    projectId: vectors.request.projectId,
    toolId: "createUiNode",
    operationClass: "mutation",
    expiresAtMs: null,
    status: "active",
  });
  store.insertOperationPolicy({
    toolId: "createUiNode",
    contractVersion: 1,
    enabled: true,
    contractHash: vectors.request.tool.contractHash,
    minimumRelayBuild: "2.0.0",
    blockedRelayBuilds: [],
    creatorRange: ">=3.7.0 <3.9.0",
    requiredConsentVersion: "project-metadata-v1",
    revision: 1,
  });
  const planners = new ProtectedToolRegistry();
  planners.register("createUiNode", 1, planCreateUiNode);
  return {
    store,
    replay: new ReplayStore(store.db),
    signer: new MemoryEnvelopeSigner("execution-fixture-1", executionPrivateKey),
    planners,
  };
}

describe("CC Bridge execute control plane", () => {
  it("returns one signed decision for an authenticated request", async () => {
    const result = await executeProtectedTool(runtime(), auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(result.status).toBe(200);
    const signed = parseSignedGatewayDecision(JSON.parse(result.body.toString("utf8")));
    const decision = parseGatewayDecision(verifyGatewayDecision(signed, executionPublicKey));
    expect(decision.kind).toBe("execute");
    expect(decision.binding.requestId).toBe(vectors.request.requestId);
  });

  it("denies execute from a pending device and allows it after approval", async () => {
    const deps = runtime();
    deps.store.db.prepare("UPDATE device SET status = 'pending'").run();
    const denied = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(JSON.parse(denied.body.toString("utf8")).code).toBe("CCB_DEVICE_DENIED");
    expect(deps.store.approveDevice(vectors.request.deviceId)).toBe(true);
    const allowed = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(allowed.status).toBe(200);
  });

  it("denies execute after device revoke", async () => {
    const deps = runtime();
    const first = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(first.status).toBe(200);
    expect(deps.store.revokeDevice(vectors.request.deviceId)).toBe(true);
    const denied = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(JSON.parse(denied.body.toString("utf8")).code).toBe("CCB_DEVICE_DENIED");
  });

  it("denies missing grants before planning or signing", async () => {
    const deps = runtime();
    deps.store.db.prepare("UPDATE grant_record SET status = 'revoked'").run();
    const result = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(result.status).toBe(422);
    expect(JSON.parse(result.body.toString("utf8")).code).toBe("CCB_PROJECT_DENIED");
    expect(deps.store.counts().replayRows).toBe(0);
  });

  it("replays the exact stored response for a completed duplicate", async () => {
    const deps = runtime();
    const first = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    const second = await executeProtectedTool(deps, auth, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(first.status).toBe(200);
    expect(second.body.equals(first.body)).toBe(true);
  });

  it("rejects a missing product grant", async () => {
    const result = await executeProtectedTool(runtime(), { ...auth, products: [] }, canonicalizeToBytes(vectors.signedRequest), vectors.request.issuedAtMs);
    expect(JSON.parse(result.body.toString("utf8")).code).toBe("CCB_PRODUCT_DENIED");
  });
});
