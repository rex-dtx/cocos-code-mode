import express, { type NextFunction, type Request, type Response, Router } from "express";
import { authMiddleware, loadOrCreateToken } from "../auth.ts";
import { CcbError, toCcbErrorBody } from "./errors.ts";
import { approveEnrolledDevice, createGrant, enrollDevice, listAdminDevices, listAdminGrants, revokeAdminGrant, revokeEnrolledDevice } from "./enrollment.ts";
import { executeProtectedTool, type ExecuteDependencies } from "./execute-service.ts";
import { CANARY_COHORTS, nextCanaryCohort } from "./canary.ts";
import { PROTOCOL_VERSION, WRAPPER_MAX_BYTES } from "./protocol.ts";
import { PublicToolRegistry } from "./public-tool-registry.ts";

function deny(res: Response, status: number, error: CcbError): void {
  res.status(status).json(toCcbErrorBody(error));
}

export function createCcBridgeRouter(
  deps: ExecuteDependencies,
  authenticate: (req: Request, res: Response, next: NextFunction) => void = authMiddleware(loadOrCreateToken()),
): Router {
  const router = Router();
  const contracts = new PublicToolRegistry();
  router.get("/v1/health", (_req: Request, res: Response) => {
    const counts = deps.store.counts();
    res.json({
      ok: deps.signer.keyId !== "unavailable",
      protocolVersion: PROTOCOL_VERSION,
      signer: deps.signer.keyId === "unavailable" ? "unavailable" : "configured",
      activeDevices: counts.activeDevices,
    });
  });
  router.get("/v1/contracts", authenticate, (req: Request, res: Response) => {
    if (!req.mcpdocsAuth) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    res.json(contracts.exportManifest());
  });
  router.post("/v1/execute",
    (req: Request, res: Response, next: NextFunction) => {
      if (req.headers["content-encoding"]) {
        deny(res, 415, new CcbError("CCB_CANONICAL_INVALID", "Compressed execute bodies are not accepted."));
        return;
      }
      const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
      if (contentType !== "application/json" && contentType !== "application/json; charset=utf-8") {
        deny(res, 415, new CcbError("CCB_CANONICAL_INVALID", "Execute requires application/json."));
        return;
      }
      next();
    },
    express.raw({ type: () => true, limit: WRAPPER_MAX_BYTES }),
    authenticate,
    async (req: Request, res: Response) => {
      const auth = req.mcpdocsAuth;
      if (!auth) {
        deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await executeProtectedTool(deps, auth, rawBody);
      res.status(result.status).type("application/json").send(result.body);
    },
  );
  router.post("/v1/devices/enroll", express.json({ limit: "8kb" }), authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.status(201).json(enrollDevice(deps.store, member, req.body));
    } catch (error) {
      const body = toCcbErrorBody(error);
      res.status(error instanceof CcbError ? 422 : 400).json(body);
    }
  });
  router.post("/v1/devices/:deviceId/approve", express.json({ limit: "4kb" }), authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.json(approveEnrolledDevice(deps.store, member, req.params.deviceId));
    } catch (error) {
      res.status(422).json(toCcbErrorBody(error));
    }
  });
  router.get("/v1/admin/devices", authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json(listAdminDevices(deps.store, member)); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });
  router.post("/v1/devices/:deviceId/revoke", authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json(revokeEnrolledDevice(deps.store, member, req.params.deviceId)); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });
  router.get("/v1/admin/grants", authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json(listAdminGrants(deps.store, member)); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });
  router.post("/v1/admin/grants", express.json({ limit: "4kb" }), authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.status(201).json(createGrant(deps.store, member, req.body)); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });
  router.post("/v1/admin/grants/:grantId/revoke", authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json(revokeAdminGrant(deps.store, member, req.params.grantId)); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });
  router.get("/v1/admin/rollout", authenticate, (req: Request, res: Response) => {
    const member = req.mcpdocsAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    if (member.role !== "admin") { deny(res, 422, new CcbError("CCB_AUTH_INVALID", "Only an admin can inspect rollout.")); return; }
    const healthy = deps.store.counts().activeDevices;
    res.json({ cohorts: CANARY_COHORTS, healthyDevices: healthy, next: nextCanaryCohort(healthy) });
  });
  return router;
}
