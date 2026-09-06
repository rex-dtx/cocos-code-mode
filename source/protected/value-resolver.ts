import { CcbError } from "./errors";
import type { ProtectedRequest } from "./protocol";

function resolvePointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value pointer is not a JSON pointer.");
  let current = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value pointer does not select an array element.");
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value pointer is outside the selected array.");
      current = current[index];
    } else if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment as keyof typeof current];
    } else {
      throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Value pointer does not exist.");
    }
  }
  return current;
}

export function resolveProvenanceValue(value: unknown, request: ProtectedRequest): unknown {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && "source" in value) {
    if (value.source === "request" && "jsonPointer" in value && typeof value.jsonPointer === "string") {
      return resolvePointer(request, value.jsonPointer);
    }
    if (value.source === "observation" && "jsonPointer" in value && typeof value.jsonPointer === "string") {
      if (!request.observation) throw new CcbError("CCB_VALUE_PROVENANCE_INVALID", "Observation value was referenced without an observation.");
      return resolvePointer(request.observation, value.jsonPointer);
    }
    if (value.source === "public-contract-constant" && "id" in value && typeof value.id === "string") return value.id;
    if (value.source === "handle" && "handle" in value && typeof value.handle === "string") return { handle: value.handle };
  }
  if (Array.isArray(value)) return value.map((item) => resolveProvenanceValue(item, request));
  const resolved: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) resolved[key] = resolveProvenanceValue(child, request);
  return resolved;
}
