import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PublicToolRegistry } from "../../src/cc-bridge/public-tool-registry.ts";
import { CONTROL_TOOLS, MUTATION_TOOLS, PROPERTY_TOOLS, READ_TOOLS } from "../../src/cc-bridge/tool-catalog.ts";

const ALL = [...READ_TOOLS, ...MUTATION_TOOLS, ...PROPERTY_TOOLS, ...CONTROL_TOOLS];

describe("CC Bridge public contracts", () => {
  it("exports a v1 contract for every catalog tool", () => {
    const registry = new PublicToolRegistry();
    const names = new Set(registry.exportManifest().tools.map((tool) => tool.name));
    expect([...names].sort()).toEqual([...ALL].sort());
    for (const name of ALL) {
      const contract = registry.get(name, 1);
      expect(contract?.contractHash).toMatch(/^[0-9a-f]{64}$/);
      if (name === "createUiNode") expect(contract?.contractHash).toBe("a".repeat(64));
      else if (name === "nodeCreate") expect(contract?.contractHash).toBe("b".repeat(64));
      else expect(contract?.contractHash).toBe(createHash("sha256").update(name).digest("hex"));
    }
  });
});
