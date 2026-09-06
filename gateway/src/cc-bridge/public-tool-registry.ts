import { createHash } from "node:crypto";
import { CONTROL_TOOLS, MUTATION_TOOLS, PROPERTY_TOOLS, READ_TOOLS } from "./tool-catalog.ts";

export interface PublicToolContract {
  name: string;
  contractVersion: number;
  contractHash: string;
  observation: { contractId: string; consentVersion: string; fields: readonly string[] };
}

const PARENT_OBSERVATION = { contractId: "ui-parent-v1", consentVersion: "project-metadata-v1", fields: ["parentUuid"] } as const;
const FIXED_HASHES: Record<string, string> = { createUiNode: "a".repeat(64), nodeCreate: "b".repeat(64) };

function contractFor(name: string): PublicToolContract {
  return {
    name,
    contractVersion: 1,
    contractHash: FIXED_HASHES[name] ?? createHash("sha256").update(name).digest("hex"),
    observation: PARENT_OBSERVATION,
  };
}

const ALL_TOOLS = [...READ_TOOLS, ...MUTATION_TOOLS, ...PROPERTY_TOOLS, ...CONTROL_TOOLS];

export class PublicToolRegistry {
  private readonly tools = new Map(ALL_TOOLS.map((name) => [`${name}@1`, contractFor(name)]));

  get(name: string, contractVersion: number): PublicToolContract | undefined {
    return this.tools.get(`${name}@${contractVersion}`);
  }

  exportManifest(): { schemaVersion: 1; tools: PublicToolContract[] } {
    return { schemaVersion: 1, tools: [...this.tools.values()] };
  }
}
