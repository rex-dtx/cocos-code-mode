import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CcbError } from "../protected/errors";
import { readPrivateJson, writePrivateJsonAtomic } from "../protected/durable-file";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const StateSchema = z.object({
  schemaVersion: z.literal(1),
  highestRootVersion: z.number().int().nonnegative(),
  highestTargetSequence: z.number().int().nonnegative(),
  highestPolicySequence: z.number().int().nonnegative(),
  rootPayloadSha256: DigestSchema.optional(),
  targetPayloadSha256: DigestSchema.optional(),
  policyPayloadSha256: DigestSchema.optional(),
  activeTargetPayloadSha256: DigestSchema.optional(),
  stagedTargetPayloadSha256: DigestSchema.optional(),
  stagedDescriptorSha256: DigestSchema.optional(),
  rollbackTargetPayloadSha256: DigestSchema.optional(),
  channel: z.string().min(1).max(64).optional(),
  ring: z.enum(["1", "3", "10"]).optional(),
  activationState: z.enum(["idle", "staged", "activating", "pending-health", "active", "rollback-required"]).default("idle"),
}).strict();

export type UpdateState = z.infer<typeof StateSchema>;
const EMPTY_STATE: UpdateState = {
  schemaVersion: 1,
  highestRootVersion: 0,
  highestTargetSequence: 0,
  highestPolicySequence: 0,
  activationState: "idle",
};

function sameSequenceDigest(currentSequence: number, nextSequence: number, currentDigest: string | undefined, nextDigest: string | undefined, label: string): void {
  if (nextSequence < currentSequence) throw new CcbError("CCB_REPLAY", `${label} sequence rolled back.`);
  if (nextSequence === currentSequence && currentSequence !== 0 && currentDigest !== nextDigest) {
    throw new CcbError("CCB_REPLAY", `${label} sequence was reused with different signed bytes.`);
  }
}

export class UpdateStateStore {
  constructor(readonly path = join(homedir(), ".cc-bridge", "update-state-v1.json")) {}

  load(): UpdateState {
    const stored = readPrivateJson(this.path, 16 * 1024);
    return stored === undefined ? { ...EMPTY_STATE } : StateSchema.parse(stored);
  }

  persistIfMonotonic(input: UpdateState): UpdateState {
    const next = StateSchema.parse(input);
    const current = this.load();
    sameSequenceDigest(current.highestRootVersion, next.highestRootVersion, current.rootPayloadSha256, next.rootPayloadSha256, "Root");
    sameSequenceDigest(current.highestTargetSequence, next.highestTargetSequence, current.targetPayloadSha256, next.targetPayloadSha256, "Target");
    sameSequenceDigest(current.highestPolicySequence, next.highestPolicySequence, current.policyPayloadSha256, next.policyPayloadSha256, "Policy");
    writePrivateJsonAtomic(this.path, next);
    return next;
  }

  markActivationQueued(): void {
    const state = this.load();
    if (state.activationState !== "staged" || !state.stagedTargetPayloadSha256 || !state.stagedDescriptorSha256) {
      throw new CcbError("CCB_BUILD_INCOMPATIBLE", "No verified staged release is ready for activation.");
    }
    this.persistIfMonotonic({ ...state, activationState: "activating" });
  }

  markHealthy(): void {
    const state = this.load();
    if (!state.stagedTargetPayloadSha256) throw new CcbError("CCB_BUILD_INCOMPATIBLE", "No staged release is pending health.");
    this.persistIfMonotonic({
      ...state,
      activeTargetPayloadSha256: state.stagedTargetPayloadSha256,
      stagedTargetPayloadSha256: undefined,
      stagedDescriptorSha256: undefined,
      rollbackTargetPayloadSha256: undefined,
      activationState: "active",
    });
  }

  markRollbackRequired(): void {
    const state = this.load();
    if (!state.rollbackTargetPayloadSha256) throw new CcbError("CCB_BUILD_INCOMPATIBLE", "No signed-policy rollback target is available.");
    this.persistIfMonotonic({ ...state, activationState: "rollback-required" });
  }
}
