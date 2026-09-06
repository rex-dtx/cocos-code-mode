import express from "express";
import { createCcBridgeRouter } from "./cc-bridge/router.ts";
import { createCcBridgeRuntime } from "./cc-bridge/runtime.ts";

const port = Number(process.env.CCB_GATEWAY_PORT || 8787);
const app = express();
app.use("/ccb", createCcBridgeRouter(createCcBridgeRuntime()));
app.listen(port, "127.0.0.1", () => {
  console.log(`cc-bridge gateway http://127.0.0.1:${port}/ccb/v1/health`);
});
