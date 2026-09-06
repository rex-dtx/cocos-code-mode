import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJsonAtomic } from "../protected/durable-file";

const StateSchema = z.object({
  schemaVersion: z.literal(1),
  highestRootVersion: z.number().int().nonnegative(),
  highestTargetSequence: z.number().int().nonnegative(),
  highestPolicySequence: z.number().int().nonnegative(),
}).strict();

export type UpdateState = z.infer<typeof StateSchema>;

export class UpdateStateStore {
  constructor(readonly path = join(homedir(), ".cc-bridge", "update-state-v1.json")) {}

  load(): UpdateState {
    const stored = readPrivateJson(this.path, 4096);
    if (stored === undefined) return { schemaVersion: 1, highestRootVersion: 0, highestTargetSequence: 0, highestPolicySequence: 0 };
    return StateSchema.parse(stored);
  }

  persistIfMonotonic(next: UpdateState): UpdateState {
    const current = this.load();
    if (next.highestRootVersion < current.highestRootVersion) throw new Error("root version rolled back");
    if (next.highestTargetSequence < current.highestTargetSequence) throw new Error("target sequence rolled back");
    if (next.highestPolicySequence < current.highestPolicySequence) throw new Error("policy sequence rolled back");
    writePrivateJsonAtomic(this.path, next);
    return next;
  }
}
