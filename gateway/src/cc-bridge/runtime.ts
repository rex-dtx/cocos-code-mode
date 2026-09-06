import { createPrivateKey } from "node:crypto";
import { CcbError } from "./errors.ts";
import { MemoryEnvelopeSigner, type EnvelopeSigner } from "./envelope-signer.ts";
import { ExecuteDependencies } from "./execute-service.ts";
import { planCreateUiNode } from "./planners/create-ui-node.ts";
import { planObservationResult } from "./planners/plan-observation-result.ts";
import { planRuntimeControl } from "./planners/plan-runtime-control.ts";
import { planEditorHistory } from "./planners/plan-editor-history.ts";
import { planEditorSelection } from "./planners/plan-editor-selection.ts";
import { planNodeOperate } from "./planners/plan-node-operate.ts";
import { planSetProperties } from "./planners/plan-set-properties.ts";
import { planAddComponent } from "./planners/plan-add-component.ts";
import { planEditorViewport } from "./planners/plan-editor-viewport.ts";
import { planBuildStart } from "./planners/plan-build-start.ts";
import { planProjectWriteSetting } from "./planners/plan-project-setting.ts";
import { planAnimationEdit } from "./planners/plan-animation-edit.ts";
import { MUTATION_TOOLS, READ_TOOLS } from "./tool-catalog.ts";
import { ProtectedToolRegistry } from "./protected-tool-registry.ts";
import { ReplayStore } from "./replay-store.ts";
import { CcBridgeStore } from "./store.ts";
import { UnixSocketSigner } from "./unix-socket-signer.ts";

class UnavailableSigner implements EnvelopeSigner {
  readonly keyId = "unavailable";
  async sign(): Promise<Buffer> {
    throw new CcbError("CCB_GATEWAY_UNAVAILABLE", "Execution signer is not configured.");
  }
}

export function createSigner(): EnvelopeSigner {
  const keyId = process.env.CCB_EXECUTION_KEY_ID;
  const socketPath = process.env.CCB_SIGNER_SOCKET;
  if (keyId && socketPath) return new UnixSocketSigner(keyId, socketPath);
  const pkcs8 = process.env.CCB_EXECUTION_PRIVATE_KEY_PKCS8;
  if (process.env.CCB_ALLOW_MEMORY_SIGNER === "1" && keyId && pkcs8) {
    return new MemoryEnvelopeSigner(
      keyId,
      createPrivateKey({ key: Buffer.from(pkcs8, "base64url"), format: "der", type: "pkcs8" }),
    );
  }
  return new UnavailableSigner();
}

export function registerCatalogPlanners(planners: ProtectedToolRegistry): void {
  for (const toolId of MUTATION_TOOLS) planners.register(toolId, 1, planCreateUiNode);
  for (const toolId of READ_TOOLS) planners.register(toolId, 1, (context) => planObservationResult(context));
  planners.register("runtimePause", 1, (context) => planRuntimeControl(context, "pause"));
  planners.register("runtimeResume", 1, (context) => planRuntimeControl(context, "resume"));
  planners.register("runtimeSetTimeScale", 1, (context) => planRuntimeControl(context, "set-time-scale"));
  planners.register("runtimeGetState", 1, (context) => planRuntimeControl(context, "get-state"));
  planners.register("editorHistory", 1, (context) => planEditorHistory(context, "undo"));
  planners.register("editorSelect", 1, (context) => planEditorSelection(context));
  planners.register("nodeOperate", 1, planNodeOperate);
  planners.register("nodeReset", 1, planNodeOperate);
  planners.register("inspectorSet", 1, planSetProperties);
  planners.register("nodeBatchSet", 1, planSetProperties);
  planners.register("nodeComponentManage", 1, planAddComponent);
  planners.register("editorViewport", 1, planEditorViewport);
  planners.register("buildManage", 1, planBuildStart);
  planners.register("projectManage", 1, planProjectWriteSetting);
  planners.register("animationEdit", 1, planAnimationEdit);
  planners.register("propertyArrayElement", 1, planSetProperties);
  planners.register("nodeClipboard", 1, planNodeOperate);
  planners.register("sceneManage", 1, planNodeOperate);
  planners.register("simulateButtonClick", 1, (context) => planEditorSelection(context));
}

export function createCcBridgeRuntime(): ExecuteDependencies {
  const store = new CcBridgeStore();
  const planners = new ProtectedToolRegistry();
  registerCatalogPlanners(planners);
  return {
    store,
    replay: new ReplayStore(store.db),
    signer: createSigner(),
    planners,
  };
}
