import express from "express";
import { createCcBridgeRouter } from "./cc-bridge/router.ts";
import { createCcBridgeRuntime } from "./cc-bridge/runtime.ts";

const port = Number(process.env.CCB_GATEWAY_PORT || 8787);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("CCB_GATEWAY_PORT must be a valid TCP port");
}
const host = process.env.CCB_GATEWAY_HOST || "127.0.0.1";
const containerLoopback = process.env.CCB_GATEWAY_CONTAINER_LOOPBACK === "1";
if (host !== "127.0.0.1" && host !== "::1" && !(host === "0.0.0.0" && process.env.NODE_ENV === "development" && containerLoopback)) {
  throw new Error("CCB_GATEWAY_HOST must be loopback; container loopback mode is development-only and explicit.");
}
const runtime = createCcBridgeRuntime();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use("/ccb", createCcBridgeRouter(runtime));
const server = app.listen(port, host, () => {
  console.log(`cc-bridge gateway http://${host}:${port}/ccb/v1/health`);
});

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    runtime.store.close();
    process.exit(0);
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
