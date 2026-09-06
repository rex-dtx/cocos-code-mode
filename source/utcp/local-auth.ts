import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CcbError, CcbErrorBody, toCcbErrorBody } from "../protected/errors";
import { readPrivateJson, writePrivateJsonAtomic } from "../protected/durable-file";

export const LOCAL_TOKEN_HEADER = "x-ccb-local-token";
export const LOCAL_TOKEN_VARIABLE = "CCB_LOCAL_TOKEN";
const LocalTokenSchema = z.object({
  schemaVersion: z.literal(1),
  relayInstanceId: z.string().uuid(),
  token: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export interface LocalAuthContext {
  relayInstanceId: string;
  token: string;
  variableName: string;
}

export interface LocalIngressDenial {
  status: number;
  body: CcbErrorBody;
}

export function loadOrCreateLocalAuth(relayInstanceId: string, root = join(homedir(), ".cc-bridge", "local-auth")): LocalAuthContext {
  const path = join(root, `${relayInstanceId}.json`);
  const stored = readPrivateJson(path, 4096);
  if (stored !== undefined) {
    const parsed = LocalTokenSchema.parse(stored);
    return { relayInstanceId, token: parsed.token, variableName: LOCAL_TOKEN_VARIABLE };
  }
  const token = randomBytes(32).toString("base64url");
  writePrivateJsonAtomic(path, { schemaVersion: 1, relayInstanceId, token });
  return { relayInstanceId, token, variableName: LOCAL_TOKEN_VARIABLE };
}

function tokenMatches(expected: string, received: unknown): boolean {
  const candidate = typeof received === "string" && received.length <= 128 ? received : "";
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(expectedDigest, candidateDigest) && candidate.length === expected.length;
}

function denial(status: number, code: ConstructorParameters<typeof CcbError>[0], error: string): LocalIngressDenial {
  return { status, body: toCcbErrorBody(new CcbError(code, error)) };
}

export function validateLocalIngress(auth: LocalAuthContext, request: IncomingMessage): LocalIngressDenial | undefined {
  const remoteAddress = request.socket.remoteAddress;
  if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::ffff:127.0.0.1") {
    return denial(403, "CCB_AUTH_INVALID", "Local route accepts loopback clients only.");
  }
  if (request.headers.forwarded !== undefined || request.headers["x-forwarded-for"] !== undefined || request.headers["x-real-ip"] !== undefined) {
    return denial(400, "CCB_AUTH_INVALID", "Forwarded client identity headers are not accepted.");
  }
  const localPort = request.socket.localPort;
  const host = request.headers.host;
  if (typeof host !== "string" || !new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`]).has(host.toLowerCase())) {
    return denial(400, "CCB_AUTH_INVALID", "Local request Host is invalid.");
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    let parsedOrigin: URL;
    try { parsedOrigin = new URL(origin); } catch { return denial(403, "CCB_AUTH_INVALID", "Request Origin is invalid."); }
    if ((parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
      || !["127.0.0.1", "localhost"].includes(parsedOrigin.hostname)
      || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
      return denial(403, "CCB_AUTH_INVALID", "Foreign request Origin is not accepted.");
    }
  }
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
    return denial(403, "CCB_AUTH_INVALID", "Cross-site browser requests are not accepted.");
  }
  if (request.headers["content-encoding"] !== undefined) {
    return denial(415, "CCB_CANONICAL_INVALID", "Compressed local request bodies are not accepted.");
  }
  if (!["GET", "POST", "PUT", "DELETE"].includes(request.method || "")) {
    return denial(405, "CCB_AUTH_INVALID", "HTTP method is not allowed.");
  }
  if (request.method !== "GET") {
    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (contentType !== "application/json" && contentType !== "application/json; charset=utf-8") {
      return denial(415, "CCB_CANONICAL_INVALID", "Local request requires application/json; charset=utf-8.");
    }
  }
  if (!tokenMatches(auth.token, request.headers[LOCAL_TOKEN_HEADER])) {
    return denial(401, "CCB_AUTH_REQUIRED", "Valid local API token is required.");
  }
  return undefined;
}
