import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { URL } from "url";
import { CcbError, toCcbErrorBody } from "../protected/errors";
import { LocalAuthContext, validateLocalIngress } from "./local-auth";

const MAX_BODY_BYTES = 1024 * 1024;
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface LocalHttpContext {
  method: HttpMethod;
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  request: IncomingMessage;
  response: ServerResponse;
  startedAt: number;
}

export type LocalHttpHandler = (context: LocalHttpContext) => void | Promise<void>;

export function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (response.writableEnded) return;
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(bytes.length),
    "cache-control": "no-store",
    ...headers,
  });
  response.end(bytes);
}

function decodeScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "__null__") return null;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function parseQuery(url: URL): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of url.searchParams) {
    const value = decodeScalar(raw);
    const current = result[key];
    if (current === undefined) result[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else result[key] = [current, value];
  }
  return result;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method === "GET") return undefined;
  const declared = Number(request.headers["content-length"] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    throw new CcbError("CCB_LIMIT_EXCEEDED", `Local request body must not exceed ${MAX_BODY_BYTES} bytes.`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_BODY_BYTES) throw new CcbError("CCB_LIMIT_EXCEEDED", `Local request body must not exceed ${MAX_BODY_BYTES} bytes.`);
    chunks.push(bytes);
  }
  if (total === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    throw new CcbError("CCB_CANONICAL_INVALID", "Local request body is not valid JSON.");
  }
}

export class LocalHttpServer {
  private readonly routes = new Map<string, LocalHttpHandler>();
  private server: Server | null = null;

  constructor(private readonly auth: LocalAuthContext) {}

  route(method: HttpMethod, path: string, handler: LocalHttpHandler): void {
    const key = `${method} ${path}`;
    if (this.routes.has(key)) throw new Error(`duplicate local route: ${key}`);
    this.routes.set(key, handler);
  }

  async listen(port: number): Promise<number> {
    if (this.server) throw new Error("local HTTP server already started");
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("local HTTP server did not expose a TCP port");
    return address.port;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = Date.now();
    try {
      const denial = validateLocalIngress(this.auth, request);
      if (denial) {
        sendJson(response, denial.status, denial.body);
        return;
      }
      const url = new URL(request.url || "/", "http://localhost");
      const method = request.method as HttpMethod;
      const handler = this.routes.get(`${method} ${url.pathname}`);
      if (!handler) {
        sendJson(response, 404, { error: "Local route not found." });
        return;
      }
      const body = await readJsonBody(request);
      await handler({ method, path: url.pathname, query: parseQuery(url), body, request, response, startedAt });
      if (!response.writableEnded) sendJson(response, 204, null);
    } catch (error) {
      const typed = error instanceof CcbError ? error : new CcbError("CCB_INTERNAL", "Local request failed.");
      const status = typed.body.code === "CCB_LIMIT_EXCEEDED" ? 413 : typed.body.code === "CCB_CANONICAL_INVALID" ? 400 : 500;
      sendJson(response, status, toCcbErrorBody(typed), { "x-duration-ms": String(Date.now() - startedAt) });
    }
  }
}
