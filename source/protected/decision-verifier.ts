import { KeyLike, createHash } from "crypto";
import { CcbError } from "./errors";
import {
  CLOCK_SKEW_MAX_MS, GatewayDecision, ProtectedRequest, SignedGatewayDecision,
  decodeBase64Url, verifyGatewayDecision,
} from "./protocol";
import { parseGatewayDecision, parseSignedGatewayDecision } from "./schemas";
import { ReplayAdmission, ReplayWindow } from "./replay-window";

export interface VerifiedGatewayDecision {
  decision: GatewayDecision;
  decisionDigest: string;
  replay: ReplayAdmission;
}

export interface DecisionVerificationOptions {
  request: ProtectedRequest;
  signed: SignedGatewayDecision;
  executionKeys: ReadonlyMap<string, KeyLike>;
  replayWindow: ReplayWindow;
  expectedCreatorRange: string;
  nowMs?: number;
}

function equalToolBinding(left: ProtectedRequest["tool"], right: GatewayDecision["binding"]["tool"]): boolean {
  return left.id === right.id && left.contractVersion === right.contractVersion && left.contractHash === right.contractHash;
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) return undefined;
  const version: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return version.every(Number.isSafeInteger) ? version : undefined;
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function versionSatisfies(versionText: string, range: string): boolean {
  const version = parseVersion(versionText);
  if (!version) return false;
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+(?:[-+].*)?)$/.exec(clause);
    if (!match) return false;
    const boundary = parseVersion(match[2]);
    if (!boundary) return false;
    const compared = compareVersion(version, boundary);
    switch (match[1] ?? "=") {
      case ">=": return compared >= 0;
      case "<=": return compared <= 0;
      case ">": return compared > 0;
      case "<": return compared < 0;
      case "=": return compared === 0;
      default: return false;
    }
  });
}

export function verifyDecision(options: DecisionVerificationOptions): VerifiedGatewayDecision {
  let signed: SignedGatewayDecision;
  try {
    signed = parseSignedGatewayDecision(options.signed);
  } catch {
    throw new CcbError("CCB_CANONICAL_INVALID", "Gateway decision wrapper is invalid.");
  }
  const executionKey = options.executionKeys.get(signed.executionKeyId);
  if (!executionKey) throw new CcbError("CCB_SIGNATURE_INVALID", "Gateway execution key is not trusted.", { executionKeyId: signed.executionKeyId });

  let verifiedPayload: unknown;
  try {
    verifiedPayload = verifyGatewayDecision(signed, executionKey);
  } catch {
    throw new CcbError("CCB_SIGNATURE_INVALID", "Gateway decision signature or canonical payload is invalid.");
  }

  let decision: GatewayDecision;
  try {
    decision = parseGatewayDecision(verifiedPayload);
  } catch {
    throw new CcbError("CCB_CONTRACT_MISMATCH", "Gateway decision does not match the protected v1 contract.");
  }

  const request = options.request;
  const binding = decision.binding;
  const commonBindingMatches = binding.requestId === request.requestId
    && binding.deviceId === request.deviceId
    && binding.projectId === request.projectId
    && binding.relayInstanceId === request.relayInstanceId
    && binding.nonce === request.nonce
    && binding.sequence === request.sequence
    && equalToolBinding(request.tool, binding.tool);
  if (!commonBindingMatches) throw new CcbError("CCB_CONTRACT_MISMATCH", "Gateway decision binding does not match the signed request.");
  if (binding.relay.build !== request.relay.build || binding.relay.packageHash !== request.relay.packageHash) {
    throw new CcbError("CCB_BUILD_INCOMPATIBLE", "Gateway decision relay binding does not match this build.");
  }
  if (binding.creatorRange !== options.expectedCreatorRange) {
    throw new CcbError("CCB_CONTRACT_MISMATCH", "Gateway decision Creator range differs from the public tool contract.");
  }
  if (!versionSatisfies(request.relay.creatorVersion, binding.creatorRange)) {
    throw new CcbError("CCB_CREATOR_INCOMPATIBLE", "Creator version is outside the signed decision range.", { creatorVersion: request.relay.creatorVersion });
  }

  const nowMs = options.nowMs ?? Date.now();
  if (binding.issuedAtMs > nowMs + CLOCK_SKEW_MAX_MS || binding.expiresAtMs < nowMs) {
    throw new CcbError("CCB_EXPIRED", "Gateway decision is expired or not yet valid.");
  }
  if (decision.kind === "result" && decision.limits.expiresInMs > binding.expiresAtMs - binding.issuedAtMs) {
    throw new CcbError("CCB_LIMIT_EXCEEDED", "Gateway result lifetime exceeds its signed binding.");
  }

  const payload = decodeBase64Url(signed.payload, 512 * 1024);
  const decisionDigest = createHash("sha256").update(payload).digest("hex");
  const replay = options.replayWindow.admitDecision(binding.nonce, binding.sequence, decisionDigest, binding.expiresAtMs, nowMs);
  return { decision, decisionDigest, replay };
}
