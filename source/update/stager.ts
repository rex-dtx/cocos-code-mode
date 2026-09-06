import { posix } from "node:path";

const MAX_ENTRIES = 4096;
const MAX_PATH_DEPTH = 8;

export function assertSafePackageEntry(entryPath: string, declared: ReadonlySet<string>): string {
  const normalized = posix.normalize(entryPath.replace(/\\/g, "/"));
  if (normalized.startsWith("/") || normalized.includes(":") || normalized.split("/").includes("..")) {
    throw new Error(`unsafe package path: ${entryPath}`);
  }
  if (normalized.split("/").filter(Boolean).length > MAX_PATH_DEPTH) throw new Error(`package path too deep: ${entryPath}`);
  if (!declared.has(normalized)) throw new Error(`undeclared package path: ${entryPath}`);
  return normalized;
}

export function assertPackageLimits(entryCount: number): void {
  if (entryCount > MAX_ENTRIES) throw new Error(`package has too many entries: ${entryCount}`);
}
