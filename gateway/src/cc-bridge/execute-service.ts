import { randomUUID } from "node:crypto";
import type { AuthContext } from "../auth.ts";
import { isEmergencyStopped } from "../emergency-stop.ts";
import { recordCcBridgeAudit } from "./audit.ts";
import { canonicalizeToBytes } from "./canonical-json.ts";
import { CcbError, toCcbErrorBody } from "./errors.ts";
import { authorizeProtectedRequest } from "./authorizer.ts";
import { verifyDeviceRequest } from "./device-proof.ts";
import { filterProtectedInputs } from "./input-filter.ts";
import { encodeSignature, type EnvelopeSigner } from "./envelope-signer.ts";
import { recordCcBridgeExecute } from "./metrics.ts";
import { validateGatewayDecision } from "./plan-validator.ts";
import { assertCcBridgeProduct } from "./product-grant.ts";
import { decisionSignatureBase, type SignedGatewayDecision } from "./protocol.ts";
import { canonicalRequestDigest, ReplayStore } from "./replay-store.ts";
import type { ProtectedToolRegistry } from "./protected-tool-registry.ts";
import type { CcBridgeStore } from "./store.ts";

export interface ExecuteDependencies {
  store: CcBridgeStore;
  replay: ReplayStore;
  signer: EnvelopeSigner;
  planners: ProtectedToolRegistry;
  nowMs?: () => number;
}

export interface ExecuteResult {
  status: number;
  body: Buffer;
}

function errorResult(error: unknown): ExecuteResult {
  const body = toCcbErrorBody(error);
  const status = body.code === "CCB_AUTH_REQUIRED" || body.code === "CCB_AUTH_INVALID" || body.code === "CCB_PRODUCT_DENIED"
    ? 401
    : body.code === "CCB_INTERNAL" ? 500 : 422;
  return { status, body: Buffer.from(JSON.stringify(body)) };
}

export async function executeProtectedTool(
  deps: ExecuteDependencies,
  auth: AuthContext,
  rawBody: Buffer,
  nowMs = deps.nowMs?.() ?? Date.now(),
): Promise<ExecuteResult> {
  const correlationId = randomUUID();
  let toolFamily = "unknown";
  let deviceId: string | undefined;
  let projectId: string | undefined;
  let relayBuild: string | undefined;
  try {
    if (isEmergencyStopped()) {
      throw new CcbError("CCB_GATEWAY_UNAVAILABLE", "Protected execute is stopped by the emergency gate.");
    }
    assertCcBridgeProduct(auth);
    const verified = verifyDeviceRequest(deps.store, rawBody, nowMs);
    filterProtectedInputs(verified.request);
    toolFamily = verified.request.tool.id;
    deviceId = verified.request.deviceId;
    projectId = verified.request.projectId;
    relayBuild = verified.request.relay.build;
    const digest = canonicalRequestDigest(verified.payloadBytes);
    const replayed = deps.replay.lookupCompleted(verified.request.deviceId, verified.request.idempotencyKey, digest);
    if (replayed) return finish(deps.store, { status: 200, body: replayed }, { correlationId, auth, toolFamily, deviceId, projectId, relayBuild, requestBytes: rawBody.byteLength, resultClass: "ok" });
    const authorization = authorizeProtectedRequest(deps.store, auth, verified.device, verified.request, nowMs);
    const admission = deps.replay.reserve({
      deviceId: verified.request.deviceId,
      relayInstanceId: verified.request.relayInstanceId,
      idempotencyKey: verified.request.idempotencyKey,
      requestDigest: digest,
      nonce: verified.request.nonce,
      sequence: verified.request.sequence,
      nowMs,
      expiresAtMs: nowMs + 24 * 60 * 60 * 1000,
    });
    if (admission.kind === "duplicate") return finish(deps.store, { status: 200, body: admission.responseBody }, { correlationId, auth, toolFamily, deviceId, projectId, relayBuild, requestBytes: rawBody.byteLength, resultClass: "ok" });
    deps.store.markDeviceSeen(verified.device.id, nowMs);
    const unsigned = deps.planners.plan({
      request: verified.request,
      policy: authorization.policy,
      correlationId,
      nowMs,
    });
    const decision = validateGatewayDecision(unsigned, verified.request);
    const payload = canonicalizeToBytes(decision);
    const signature = await deps.signer.sign(deps.signer.keyId, decisionSignatureBase(deps.signer.keyId, payload));
    const signed: SignedGatewayDecision = {
      executionKeyId: deps.signer.keyId,
      payload: Buffer.from(payload).toString("base64url"),
      signature: encodeSignature(signature),
    };
    const responseBody = Buffer.from(JSON.stringify(signed));
    deps.replay.complete(admission.id, admission.owner, responseBody, nowMs);
    return finish(deps.store, { status: 200, body: responseBody }, { correlationId, auth, toolFamily, deviceId, projectId, relayBuild, requestBytes: rawBody.byteLength, resultClass: "ok" });
  } catch (error) {
    const failed = errorResult(error);
    const code = toCcbErrorBody(error).code;
    return finish(deps.store, failed, {
      correlationId, auth, toolFamily, deviceId, projectId, relayBuild,
      requestBytes: rawBody.byteLength,
      resultClass: code === "CCB_INTERNAL" ? "error" : "deny",
      errorCode: code,
    });
  }
}

function finish(
  store: CcBridgeStore,
  result: ExecuteResult,
  meta: {
    correlationId: string; auth: AuthContext; toolFamily: string; deviceId?: string; projectId?: string;
    relayBuild?: string; requestBytes: number; resultClass: "ok" | "deny" | "error"; errorCode?: string;
  },
): ExecuteResult {
  try {
    recordCcBridgeAudit(store, {
      correlationId: meta.correlationId,
      memberId: meta.auth.member_id,
      deviceId: meta.deviceId,
      projectId: meta.projectId,
      toolFamily: meta.toolFamily,
      relayBuild: meta.relayBuild,
      resultClass: meta.resultClass,
      errorCode: meta.errorCode,
      requestBytes: meta.requestBytes,
      responseBytes: result.body.byteLength,
      phaseTimings: {},
    });
    recordCcBridgeExecute(meta.toolFamily, meta.resultClass);
  } catch {
    /* audit/metrics must not fail the signed response */
  }
  return result;
}
