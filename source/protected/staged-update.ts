import { createHash } from "crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CcbError } from "./errors";

export interface PendingRelease {
  artifact: string;
  sha256: string;
  bytes: number;
}

export const PENDING_DIR = join(homedir(), ".cc-bridge", "updates");

export function verifyStagedZip(dir = PENDING_DIR): { zipPath: string; sha256: string } {
  const manifestPath = join(dir, "release-manifest.json");
  const zipPath = join(dir, "pending.zip");
  if (!existsSync(manifestPath) || !existsSync(zipPath)) {
    throw new CcbError("CCB_BUILD_INCOMPATIBLE", "No staged signed ZIP is waiting for activation.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PendingRelease;
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    throw new CcbError("CCB_SIGNATURE_INVALID", "Staged release manifest SHA-256 is malformed.");
  }
  const bytes = readFileSync(zipPath);
  if (bytes.length !== manifest.bytes) {
    throw new CcbError("CCB_SIGNATURE_INVALID", "Staged ZIP size does not match the release manifest.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== manifest.sha256) {
    throw new CcbError("CCB_SIGNATURE_INVALID", "Staged ZIP hash does not match the release manifest.");
  }
  return { zipPath, sha256 };
}

export function activateStagedZip(dir = PENDING_DIR, activeZip = join(dir, "active.zip")): { sha256: string; rollback: string | null } {
  const verified = verifyStagedZip(dir);
  mkdirSync(join(activeZip, ".."), { recursive: true });
  const rollback = `${activeZip}.rollback`;
  let keptRollback: string | null = null;
  if (existsSync(activeZip)) {
    rmSync(rollback, { force: true });
    renameSync(activeZip, rollback);
    keptRollback = rollback;
  }
  copyFileSync(verified.zipPath, activeZip);
  return { sha256: verified.sha256, rollback: keptRollback };
}
