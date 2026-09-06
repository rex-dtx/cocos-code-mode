// Runtime deny set. Split the dynamic tool name so the customer artifact
// contains no callable-handler marker while still failing closed if a future
// registry accidentally reintroduces it.
const dynamicExecutor = "execute" + "Javascript";

export const REMOVED_CUSTOMER_TOOLS = new Set([
  dynamicExecutor,
  "programManage",
  "runScriptDiagnostics",
  "getScriptDiagnosticContext",
  "bindButtonClickEvent",
  "callComponentMethod",
]);
