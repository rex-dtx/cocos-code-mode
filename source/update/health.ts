import { setTimeout as delay } from "node:timers/promises";
import type { RelayState } from "../protected/state-machine";
import { CcbError } from "../protected/errors";

export type UpdateHealthFailure =
  | "utcp-not-ready"
  | "relay-not-active"
  | "identity-incompatible"
  | "package-incompatible"
  | "creator-incompatible"
  | "protected-probe-failed"
  | "protected-probe-timeout";

export interface UpdateHealthInput {
  utcpReady: boolean;
  relayState: RelayState;
  identityCompatible: boolean;
  packageCompatible: boolean;
  creatorCompatible: boolean;
  protectedProbeTimeoutMs: number;
  protectedProbe: (signal: AbortSignal) => Promise<boolean>;
}

export interface UpdateHealthResult {
  healthy: boolean;
  failures: readonly UpdateHealthFailure[];
  probeDurationMs?: number;
}

export async function evaluateUpdateHealth(input: UpdateHealthInput): Promise<UpdateHealthResult> {
  if (!Number.isSafeInteger(input.protectedProbeTimeoutMs)
    || input.protectedProbeTimeoutMs < 1
    || input.protectedProbeTimeoutMs > 30_000) {
    throw new CcbError("CCB_CANONICAL_INVALID", "Protected update-health probe timeout must be between 1 and 30000 ms.");
  }
  const failures: UpdateHealthFailure[] = [];
  if (!input.utcpReady) failures.push("utcp-not-ready");
  if (input.relayState !== "ACTIVE") failures.push("relay-not-active");
  if (!input.identityCompatible) failures.push("identity-incompatible");
  if (!input.packageCompatible) failures.push("package-incompatible");
  if (!input.creatorCompatible) failures.push("creator-incompatible");
  if (failures.length > 0) return { healthy: false, failures };

  const startedAt = Date.now();
  const signal = AbortSignal.timeout(input.protectedProbeTimeoutMs);
  let probeOutcome: "passed" | "failed" | "timeout";
  try {
    probeOutcome = await Promise.race([
      input.protectedProbe(signal).then((ok) => ok ? "passed" as const : "failed" as const).catch(() => "failed" as const),
      delay(input.protectedProbeTimeoutMs, undefined, { ref: false }).then(() => "timeout" as const),
    ]);
  } catch {
    probeOutcome = "failed";
  }
  const probeDurationMs = Date.now() - startedAt;
  if (probeOutcome === "passed") return { healthy: true, failures, probeDurationMs };
  failures.push(probeOutcome === "timeout" ? "protected-probe-timeout" : "protected-probe-failed");
  return { healthy: false, failures, probeDurationMs };
}
