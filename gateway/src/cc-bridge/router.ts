import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response, Router } from "express";
import { createGatewayAdmission, type GatewayAdmission } from "./admission.ts";
import { createMemberAuthMiddleware, requireCcBridgeProduct } from "./auth-middleware.ts";
import { CcbError, toCcbErrorBody } from "./errors.ts";
import { approveEnrolledDevice, createGrant, enrollDevice, issueEnrollmentChallenge, listAdminDevices, listAdminGrants, revokeAdminGrant, revokeEnrolledDevice } from "./enrollment.ts";
import { executeProtectedTool, type ExecuteDependencies } from "./execute-service.ts";
import { CANARY_COHORTS, nextCanaryCohort } from "./canary.ts";
import { PROTOCOL_VERSION, WRAPPER_MAX_BYTES } from "./protocol.ts";
import { PublicToolRegistry } from "./public-tool-registry.ts";
import { ccbMetricsRegistry, recordCcBridgeRuntimeState } from "./metrics.ts";
import { importReleaseTarget, loadReleaseKeySet, publishRolloutPolicy } from "./release-admin.ts";

function deny(res: Response, status: number, error: CcbError): void {
  res.status(status).json(toCcbErrorBody(error));
}

const typedBodyParserErrors: ErrorRequestHandler = (error, _req, res, _next): void => {
  const parserError = error as { type?: unknown };
  if (parserError.type === "entity.too.large") {
    deny(res, 413, new CcbError("CCB_LIMIT_EXCEEDED", "Request body exceeds the route byte limit."));
    return;
  }
  if (error instanceof SyntaxError || parserError.type === "entity.parse.failed") {
    deny(res, 400, new CcbError("CCB_CANONICAL_INVALID", "Request body is not valid JSON."));
    return;
  }
  deny(res, 500, new CcbError("CCB_INTERNAL", "CC Bridge request handling failed."));
};

export function createCcBridgeRouter(
  deps: ExecuteDependencies,
  authenticate: (req: Request, res: Response, next: NextFunction) => void = createMemberAuthMiddleware(),
  admission: GatewayAdmission = createGatewayAdmission(),
): Router {
  const router = Router();
  const contracts = new PublicToolRegistry();
  const memberProductAuth = [authenticate, admission.enforceMemberRate, requireCcBridgeProduct] as const;

  router.get("/v1/health", (_req: Request, res: Response) => {
    const counts = deps.store.counts();
    recordCcBridgeRuntimeState({
      signerAvailable: deps.signer.keyId !== "unavailable",
      activeDevices: counts.activeDevices,
      replayEntries: counts.replayRows,
    });
    res.json({
      ok: deps.signer.keyId !== "unavailable",
      protocolVersion: PROTOCOL_VERSION,
      signer: deps.signer.keyId === "unavailable" ? "unavailable" : "configured",
      activeDevices: counts.activeDevices,
    });
  });

  router.use(admission.enforceHostAndIp);

  router.get("/v1/contracts", ...memberProductAuth, (req: Request, res: Response) => {
    if (!req.toolAuth) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    res.json(contracts.exportManifest());
  });

  router.post(
    "/v1/execute",
    ...memberProductAuth,
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
    admission.enforceExecuteConcurrency,
    async (req: Request, res: Response) => {
      const auth = req.toolAuth;
      if (!auth) {
        deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
        return;
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const result = await executeProtectedTool(deps, auth, rawBody);
      res.status(result.status).type("application/json").send(result.body);
    },
  );

  router.post(
    "/v1/devices/challenge",
    ...memberProductAuth,
    express.json({ limit: "2kb" }),
    (req: Request, res: Response) => {
      const member = req.toolAuth;
      if (!member) {
        deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
        return;
      }
      try {
        res.status(201).json(issueEnrollmentChallenge(deps.store, member, req.body));
      } catch (error) {
        res.status(error instanceof CcbError ? 422 : 400).json(toCcbErrorBody(error));
      }
    },
  );

  router.post(
    "/v1/devices/enroll",
    ...memberProductAuth,
    express.json({ limit: "8kb" }),
    (req: Request, res: Response) => {
      const member = req.toolAuth;
      if (!member) {
        deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
        return;
      }
      try {
        res.status(201).json(enrollDevice(deps.store, member, req.body));
      } catch (error) {
        res.status(error instanceof CcbError ? 422 : 400).json(toCcbErrorBody(error));
      }
    },
  );

  router.post("/v1/devices/:deviceId/approve", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
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

  router.get("/v1/admin/devices", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.json(listAdminDevices(deps.store, member));
    } catch (error) {
      res.status(422).json(toCcbErrorBody(error));
    }
  });

  router.post("/v1/devices/:deviceId/revoke", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.json(revokeEnrolledDevice(deps.store, member, req.params.deviceId));
    } catch (error) {
      res.status(422).json(toCcbErrorBody(error));
    }
  });

  router.get("/v1/admin/grants", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.json(listAdminGrants(deps.store, member));
    } catch (error) {
      res.status(422).json(toCcbErrorBody(error));
    }
  });

  router.post(
    "/v1/admin/grants",
    ...memberProductAuth,
    express.json({ limit: "4kb" }),
    (req: Request, res: Response) => {
      const member = req.toolAuth;
      if (!member) {
        deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
        return;
      }
      try {
        res.status(201).json(createGrant(deps.store, member, req.body));
      } catch (error) {
        res.status(422).json(toCcbErrorBody(error));
      }
    },
  );

  router.post("/v1/admin/grants/:grantId/revoke", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    try {
      res.json(revokeAdminGrant(deps.store, member, req.params.grantId));
    } catch (error) {
      res.status(422).json(toCcbErrorBody(error));
    }
  });

  router.get("/v1/admin/rollout", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    if (member.role !== "admin") {
      deny(res, 422, new CcbError("CCB_AUTH_INVALID", "Only an admin can inspect rollout."));
      return;
    }
    const healthy = deps.store.counts().activeDevices;
    res.json({ cohorts: CANARY_COHORTS, healthyDevices: healthy, next: nextCanaryCohort(healthy) });
  });

  router.get("/v1/metrics", ...memberProductAuth, async (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) {
      deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required."));
      return;
    }
    if (member.role !== "admin") {
      deny(res, 422, new CcbError("CCB_AUTH_INVALID", "Only an admin can inspect metrics."));
      return;
    }
    const counts = deps.store.counts();
    recordCcBridgeRuntimeState({
      signerAvailable: deps.signer.keyId !== "unavailable",
      activeDevices: counts.activeDevices,
      replayEntries: counts.replayRows,
    });
    res.type(ccbMetricsRegistry.contentType).send(await ccbMetricsRegistry.metrics());
  });

  router.post("/v1/admin/releases/targets", ...memberProductAuth, express.json({ limit: "16kb" }), (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    const keys = loadReleaseKeySet();
    if (!keys) { deny(res, 503, new CcbError("CCB_GATEWAY_UNAVAILABLE", "Release verification keys are not configured.")); return; }
    try { res.status(201).json(importReleaseTarget(deps.store, member, req.body, keys)); }
    catch (error) { res.status(error instanceof CcbError ? 422 : 400).json(toCcbErrorBody(error)); }
  });

  router.get("/v1/admin/releases/targets", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json({ targets: deps.store.listReleaseTargets() }); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });

  router.post("/v1/admin/releases/policies", ...memberProductAuth, express.json({ limit: "16kb" }), (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    const keys = loadReleaseKeySet();
    if (!keys) { deny(res, 503, new CcbError("CCB_GATEWAY_UNAVAILABLE", "Release verification keys are not configured.")); return; }
    try { res.status(201).json(publishRolloutPolicy(deps.store, member, req.body, keys)); }
    catch (error) { res.status(error instanceof CcbError ? 422 : 400).json(toCcbErrorBody(error)); }
  });

  router.get("/v1/admin/releases/policies", ...memberProductAuth, (req: Request, res: Response) => {
    const member = req.toolAuth;
    if (!member) { deny(res, 401, new CcbError("CCB_AUTH_REQUIRED", "Member authentication is required.")); return; }
    try { res.json({ policies: deps.store.listRolloutPolicies() }); }
    catch (error) { res.status(422).json(toCcbErrorBody(error)); }
  });

  router.use(typedBodyParserErrors);
  return router;
}
