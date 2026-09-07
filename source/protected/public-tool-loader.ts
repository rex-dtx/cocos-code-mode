import { createHash } from "crypto";
import { canonicalizeToBytes } from "./canonical-json";
import {
  PublicToolBehavior,
  PublicToolBehaviorSchema,
  PublicToolContract,
  PublicToolManifest,
  PublicToolManifestSchema,
} from "./schemas";
import { GATEWAY_PROTECTED_TOOL_NAMES } from "./protected-tool-names";

export type { PublicToolBehavior, PublicToolContract, PublicToolManifest } from "./schemas";

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalizeToBytes(value)).digest("hex");
}

export function publicToolBehavior(contract: PublicToolContract): PublicToolBehavior {
  const { contractHash: _contractHash, ...behavior } = contract;
  return PublicToolBehaviorSchema.parse(behavior);
}

export function hashPublicToolBehavior(behavior: PublicToolBehavior): string {
  return sha256Canonical(PublicToolBehaviorSchema.parse(behavior));
}

export function hashPublicToolManifest(manifest: Pick<PublicToolManifest, "schemaVersion" | "tools">): string {
  return sha256Canonical({ schemaVersion: manifest.schemaVersion, tools: manifest.tools });
}

function operationNames(contract: PublicToolContract): string[] {
  const properties = contract.inputSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties) || !("operation" in properties)) return ["*"];
  const operation = properties.operation;
  if (!operation || typeof operation !== "object" || Array.isArray(operation) || !("enum" in operation)) return ["*"];
  const values = operation.enum;
  return Array.isArray(values) && values.every((value) => typeof value === "string") ? [...values] : ["*"];
}

function validateTool(contract: PublicToolContract): void {
  const properties = contract.inputSchema.properties;
  const allowed = properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties).sort()
    : [];
  if (allowed.join("\0") !== [...contract.allowedInputFields].sort().join("\0")) {
    throw new Error(`public tool ${contract.name} allowed input fields do not match its input schema`);
  }
  const classified = contract.inputFields.map((field) => field.jsonPointer.slice(1)).sort();
  if (allowed.join("\0") !== classified.join("\0")) {
    throw new Error(`public tool ${contract.name} input data classifications do not match its input schema`);
  }
  const expectedOperations = operationNames(contract).sort();
  const actualOperations = Object.keys(contract.operations).sort();
  if (expectedOperations.join("\0") !== actualOperations.join("\0")) {
    throw new Error(`public tool ${contract.name} operation map does not match its input schema`);
  }
  const expectedHash = hashPublicToolBehavior(publicToolBehavior(contract));
  if (contract.contractHash !== expectedHash) {
    throw new Error(`public tool ${contract.name} contract hash mismatch`);
  }
}

export function loadPublicToolManifest(value: unknown): PublicToolManifest {
  const manifest = PublicToolManifestSchema.parse(value);
  const names = manifest.tools.map((tool) => tool.name);
  const expectedNames = [...GATEWAY_PROTECTED_TOOL_NAMES].sort();
  if (new Set(names).size !== names.length) throw new Error("public tool manifest has duplicate names");
  if (names.join("\0") !== [...names].sort().join("\0")) throw new Error("public tool manifest tools must be sorted by name");
  if (names.join("\0") !== expectedNames.join("\0")) throw new Error("public tool manifest does not contain the exact protected tool set");
  for (const contract of manifest.tools) validateTool(contract);
  const expectedManifestHash = hashPublicToolManifest(manifest);
  if (manifest.manifestHash !== expectedManifestHash) throw new Error("public tool manifest hash mismatch");
  return manifest;
}

export function findPublicTool(manifest: PublicToolManifest, name: string): PublicToolContract {
  const tool = manifest.tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`unknown public protected tool: ${name}`);
  return tool;
}

export function findPublicToolOperation(contract: PublicToolContract, inputs: unknown) {
  let operation: unknown;
  if (inputs && typeof inputs === "object" && !Array.isArray(inputs) && "operation" in inputs) {
    operation = inputs.operation;
  }
  if (operation === undefined) {
    const properties = contract.inputSchema.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties) && "operation" in properties) {
      const operationSchema = properties.operation;
      if (operationSchema && typeof operationSchema === "object" && !Array.isArray(operationSchema) && "default" in operationSchema) {
        operation = operationSchema.default;
      }
    }
  }
  const key = typeof operation === "string" ? operation : "*";
  const selected = contract.operations[key];
  if (!selected) throw new Error(`unsupported ${contract.name} operation: ${String(operation)}`);
  return selected;
}
