import type { OperationClass } from "./store.ts";

const READ_INPUTS = ["uuid", "url", "path", "query", "reference", "root", "depth", "maxDepth", "maxNodes", "verbose", "assetPath", "nodeUuid"] as const;

export const READ_TOOLS = [
  "sceneGetInfo", "nodeGetTree", "nodeGetAtPath", "assetGetTree", "assetGetAtPath", "assetResolvePath",
  "assetFindReferences", "assetQuery", "assetGetAvailableUrl", "nodeGetAvailableComponentTypes", "nodeComponentsGet",
  "findNodesByAsset", "findNodesWithMissingAssets", "findNodes", "animationQuery", "materialQuery", "inspectorGet",
  "inspectorGetDefinition", "editorQuery", "sceneBatchGet", "assetBatchQuery", "getPerformanceSnapshot",
] as const;

export const MUTATION_TOOLS = ["createUiNode", "nodeCreate", "createLabel", "createButton", "createSprite", "nodeCreatePrimitive"] as const;
export const PROPERTY_TOOLS = ["nodeOperate", "nodeReset", "inspectorSet", "nodeBatchSet", "nodeComponentManage", "projectManage", "animationEdit", "propertyArrayElement", "nodeClipboard", "sceneManage"] as const;
export const CONTROL_TOOLS = ["runtimePause", "runtimeResume", "runtimeSetTimeScale", "runtimeGetState", "editorHistory", "editorSelect", "editorViewport", "buildManage", "simulateButtonClick"] as const;

export const TOOL_CLASS: Record<string, OperationClass> = {
  ...Object.fromEntries(READ_TOOLS.map((id) => [id, "read"])),
  ...Object.fromEntries(MUTATION_TOOLS.map((id) => [id, "mutation"])),
  ...Object.fromEntries(PROPERTY_TOOLS.map((id) => [id, "mutation"])),
  ...Object.fromEntries(CONTROL_TOOLS.map((id) => [id, "control"])),
};

export const ALLOWED_INPUTS: Record<string, ReadonlySet<string>> = {
  createUiNode: new Set(["name", "uiType", "parentReference", "width", "height", "quality"]),
  nodeCreate: new Set(["name", "parentReference"]),
  createLabel: new Set(["name", "text", "parentReference", "fontSize"]),
  createButton: new Set(["name", "text", "parentReference"]),
  createSprite: new Set(["name", "parentReference", "spriteFrame"]),
  nodeCreatePrimitive: new Set(["name", "parentReference", "primitive"]),
  nodeOperate: new Set(["uuid", "action", "destination"]),
  nodeReset: new Set(["uuid"]),
  inspectorSet: new Set(["uuid", "name", "path", "value"]),
  nodeBatchSet: new Set(["uuid", "values"]),
  nodeComponentManage: new Set(["uuid", "componentType", "action"]),
  runtimePause: new Set(),
  runtimeResume: new Set(),
  runtimeSetTimeScale: new Set(["value"]),
  runtimeGetState: new Set(),
  editorHistory: new Set(["action"]),
  editorViewport: new Set(["uuid", "action"]),
  projectManage: new Set(["name", "action"]),
  buildManage: new Set(["options", "action", "taskId"]),
  animationEdit: new Set(["uuid", "value", "action"]),
  propertyArrayElement: new Set(["uuid", "path", "action", "value"]),
  nodeClipboard: new Set(["uuid", "action"]),
  sceneManage: new Set(["action", "uuid"]),
  simulateButtonClick: new Set(["uuid"]),
  ...Object.fromEntries(READ_TOOLS.map((id) => [id, new Set(READ_INPUTS)])),
};
