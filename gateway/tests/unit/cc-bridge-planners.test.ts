import { describe, expect, it } from "vitest";
import { ProtectedToolRegistry } from "../../src/cc-bridge/protected-tool-registry.ts";
import { registerCatalogPlanners } from "../../src/cc-bridge/runtime.ts";
import { CONTROL_TOOLS, MUTATION_TOOLS, PROPERTY_TOOLS, READ_TOOLS } from "../../src/cc-bridge/tool-catalog.ts";

describe("CC Bridge catalog planners", () => {
  it("registers a v1 planner for every catalog tool", () => {
    const planners = new ProtectedToolRegistry();
    registerCatalogPlanners(planners);
    for (const toolId of [...READ_TOOLS, ...MUTATION_TOOLS, ...PROPERTY_TOOLS, ...CONTROL_TOOLS]) {
      expect(planners.has(toolId, 1), toolId).toBe(true);
    }
  });
});
