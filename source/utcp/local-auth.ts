import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CcbError, toCcbErrorBody } from "../protected/errors";
import { readPrivateJson, writePrivateJsonAtomic } from "../protected/durable-file";

export const LOCAL_TOKEN_HEADER = "x-ccb-local-token";
export const LOCAL_TOKEN_VARIABLE = "CCB_LOCAL_TOKEN";
const LocalTokenSchema = z.object({ schemaVersion: z.literal(1), relayInstanceId: z.string().uuid(), token: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/) }).strict();

export interface LocalAuthContext {
  relayInstanceId: string;
  token: string;
  variableName: string;
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

function deny(res: Response, status: number, error: CcbError): void {
  res.status(status).json(toCcbErrorBody(error));
}

export function createLocalIngressGuard(auth: LocalAuthContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const remoteAddress = req.socket.remoteAddress;
    if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::ffff:127.0.0.1") {
      deny(res, 403, new CcbError("CCB_AUTH_INVALID", "Local route accepts loopback clients only."));
      return;
    }
    if (req.headers.forwarded !== undefined || req.headers["x-forwarded-for"] !== undefined || req.headers["x-real-ip"] !== undefined) {
      deny(res, 400, new CcbError("CCB_AUTH_INVALID", "Forwarded client identity headers are not accepted."));
      return;
    }

    const localPort = req.socket.localPort;
    const host = req.headers.host;
    const allowedHosts = new Set([`127.0.0.1:${localPort}`, `localhost:${localPort}`]);
    if (typeof host !== "string" || !allowedHosts.has(host.toLowerCase())) {
      deny(res, 400, new CcbError("CCB_AUTH_INVALID", "Local request Host is invalid."));
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      let parsedOrigin: URL;
      try { parsedOrigin = new URL(origin); } catch {
        deny(res, 403, new CcbError("CCB_AUTH_INVALID", "Request Origin is invalid."));
        return;
      }
      if ((parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:")
        || !["127.0.0.1", "localhost"].includes(parsedOrigin.hostname)
        || parsedOrigin.username || parsedOrigin.password || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
        deny(res, 403, new CcbError("CCB_AUTH_INVALID", "Foreign request Origin is not accepted."));
        return;
      }
    }

    const fetchSite = req.headers["sec-fetch-site"];
    if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
      deny(res, 403, new CcbError("CCB_AUTH_INVALID", "Cross-site browser requests are not accepted."));
      return;
    }
    if (req.headers["content-encoding"] !== undefined) {
      deny(res, 415, new CcbError("CCB_CANONICAL_INVALID", "Compressed local request bodies are not accepted."));
      return;
    }
    if (!["GET", "POST", "PUT", "DELETE"].includes(req.method)) {
      deny(res, 405, new CcbError("CCB_AUTH_INVALID", "HTTP method is not allowed."));
      return;
    }
    if (req.method !== "GET") {
      const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
      if (contentType !== "application/json" && contentType !== "application/json; charset=utf-8") {
        deny(res, 415, new CcbError("CCB_CANONICAL_INVALID", "Local request requires application/json; charset=utf-8."));
        return;
      }
    }
    if (!tokenMatches(auth.token, req.headers[LOCAL_TOKEN_HEADER])) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Valid local API token is required."));
      return;
    }
    next();
  };
}
