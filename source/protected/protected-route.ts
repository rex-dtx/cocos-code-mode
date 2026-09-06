import { createHash } from "node:crypto";
import { assertIJson, IJson } from "./canonical-json";
import { createCreatorAdapters } from "./creator-adapters";
import { CcbError } from "./errors";
import { dispatchProtectedTool } from "./protected-dispatcher";
import type { ProtectedRelayHost } from "./relay-host";
import { GATEWAY_PROTECTED_TOOLS } from "./protected-tool-names";
import { getBuildInfo } from "../build-info";

const manifest = {
  schemaVersion: 1 as const,
  tools: [...GATEWAY_PROTECTED_TOOLS].map((name) => ({
    name,
    contractVersion: 1,
    contractHash: name === "createUiNode" ? "a".repeat(64) : name === "nodeCreate" ? "b".repeat(64) : createHash("sha256").update(name).digest("hex"),
    observation: { contractId: "ui-parent-v1", consentVersion: "project-metadata-v1", fields: ["parentUuid"] },
  })),
};

export function isProtectedCustomerTool(name: string): boolean {
  return GATEWAY_PROTECTED_TOOLS.has(name);
}

function parentUuidFromInputs(inputs: IJson): IJson {
  if (inputs && typeof inputs === "object" && !Array.isArray(inputs) && "parentReference" in inputs) {
    const parent = inputs.parentReference;
    if (parent && typeof parent === "object" && "id" in parent && typeof parent.id === "string") return parent.id;
  }
  return "scene-root";
}

export async function dispatchProtectedCustomerTool(host: ProtectedRelayHost, name: string, inputs: unknown): Promise<IJson> {
  if (!GATEWAY_PROTECTED_TOOLS.has(name)) {
    throw new CcbError("CCB_CONTRACT_MISMATCH", "Protected tool has no v1 public contract yet.", { tool: name });
  }
  host.state.assertActive();
  if (!host.client || !host.projectId || host.executionKeys.size === 0) {
    throw new CcbError("CCB_GATEWAY_UNAVAILABLE", "Protected tools require a warm Gateway client, project, and execution public key.");
  }
  assertIJson(inputs);
  const build = getBuildInfo();
  return dispatchProtectedTool({
    state: host.state,
    identity: host.identity,
    identityStore: host.identityStore,
    projectId: host.projectId,
    relayInstanceId: host.relayInstanceId,
    sequence: host.replayWindow,
    replayWindow: host.replayWindow,
    journal: host.journal,
    client: host.client,
    executionKeys: host.executionKeys,
    expectedCreatorRange: ">=3.7.0 <3.9.0",
    relay: {
      build: build.version,
      packageHash: createHash("sha256").update(`${build.version}:${build.commit}`).digest("hex"),
      creatorVersion: "3.7.3",
      os: `${process.platform}-${process.arch}`,
    },
    adapters: {
      invoke: createCreatorAdapters(async (moduleName, message, args) => Editor.Message.request(moduleName, message, args)),
      snapshot: async () => { await Editor.Message.request("scene", "snapshot"); },
      recheckPreconditions: async () => undefined,
    },
    collectField: (field) => field === "parentUuid" ? parentUuidFromInputs(inputs) : "scene-root",
  }, manifest, name, inputs);
}
