import os from "node:os";
import path from "node:path";

export function getCacheBaseDir(): string {
  return process.env.CCB_CACHE_DIR || path.join(os.homedir(), ".cache", "cc-bridge");
}
