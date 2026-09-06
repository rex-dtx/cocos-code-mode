import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth.ts";
import { canonicalizeToBytes } from "../../src/cc-bridge/canonical-json.ts";
import { MemoryEnvelopeSigner } from "../../src/cc-bridge/envelope-signer.ts";
import { planCreateUiNode } from "../../src/cc-bridge/planners/create-ui-node.ts";
import { ProtectedToolRegistry } from "../../src/cc-bridge/protected-tool-registry.ts";
import { ReplayStore } from "../../src/cc-bridge/replay-store.ts";
import { createCcBridgeRouter } from "../../src/cc-bridge/router.ts";
import { parseSignedGatewayDecision } from "../../src/cc-bridge/schemas.ts";
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
  role: "admin",
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
    id: "grant-1", memberId: auth.member_id, deviceId: vectors.request.deviceId,
    projectId: vectors.request.projectId, toolId: "createUiNode", operationClass: "mutation",
    expiresAtMs: null, status: "active",
  });
  store.insertOperationPolicy({
    toolId: "createUiNode", contractVersion: 1, enabled: true, contractHash: vectors.request.tool.contractHash,
    minimumRelayBuild: "2.0.0", blockedRelayBuilds: [], creatorRange: ">=3.7.0 <3.9.0",
    requiredConsentVersion: "project-metadata-v1", revision: 1,
  });
  const planners = new ProtectedToolRegistry();
  planners.register("createUiNode", 1, planCreateUiNode);
  return {
    store,
    replay: new ReplayStore(store.db),
    signer: new MemoryEnvelopeSigner("execution-fixture-1", executionPrivateKey),
    planners,
    nowMs: () => vectors.request.issuedAtMs as number,
  };
}

function stubAuth(req: Request, _res: Response, next: NextFunction): void {
  req.mcpdocsAuth = auth;
  next();
}

describe("CC Bridge HTTP execute", () => {
  it("returns one signed decision from POST /ccb/v1/execute", async () => {
    const app = express();
    app.use("/ccb", createCcBridgeRouter(runtime(), stubAuth));
    const server = createServer(app);
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      const health = await fetch(`http://127.0.0.1:${address.port}/ccb/v1/health`);
      expect((await health.json() as { signer: string }).signer).toBe("configured");
      const response = await fetch(`http://127.0.0.1:${address.port}/ccb/v1/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array(canonicalizeToBytes(vectors.signedRequest)),
      });
      expect(response.status).toBe(200);
      const signed = parseSignedGatewayDecision(await response.json());
      expect(verifyGatewayDecision(signed, executionPublicKey)).toMatchObject({ kind: "execute" });
    } finally {
      server.close();
    }
  });

  it("lists devices, grants, and next canary cohort for an admin", async () => {
    const app = express();
    app.use("/ccb", createCcBridgeRouter(runtime(), stubAuth));
    const server = createServer(app);
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}/ccb/v1`;
    try {
      const devices = await (await fetch(`${base}/admin/devices`)).json() as { devices: { status: string }[] };
      expect(devices.devices).toHaveLength(1);
      expect(devices.devices[0].status).toBe("approved");
      const grants = await (await fetch(`${base}/admin/grants`)).json() as { grants: { id: string }[] };
      expect(grants.grants).toHaveLength(1);
      const rollout = await (await fetch(`${base}/admin/rollout`)).json() as { next: number | "ga"; healthyDevices: number };
      expect(rollout.healthyDevices).toBe(1);
      expect(rollout.next).toBe(3);
    } finally {
      server.close();
    }
  });
});
