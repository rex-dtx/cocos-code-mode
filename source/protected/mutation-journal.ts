import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import { assertIJson, canonicalizeToBytes, IJson } from "./canonical-json";
import { CcbError } from "./errors";
import { ensurePrivateDirectory, readPrivateJson, writePrivateJsonAtomic } from "./durable-file";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const JournalSchema = z.object({
  schemaVersion: z.literal(1),
  decisionDigest: z.string().regex(DIGEST_PATTERN),
  requestId: z.string().uuid(),
  idempotencyKey: z.string().min(16).max(128),
  state: z.enum(["prepared", "started", "completed"]),
  preparedAtMs: z.number().int().positive().safe(),
  startedAtMs: z.number().int().positive().safe().optional(),
  completedAtMs: z.number().int().positive().safe().optional(),
  result: z.unknown().optional(),
}).strict();

export interface MutationJournalRecord {
  schemaVersion: 1;
  decisionDigest: string;
  requestId: string;
  idempotencyKey: string;
  state: "prepared" | "started" | "completed";
  preparedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  result?: IJson;
}

export type JournalAdmission =
  | { action: "execute"; record: MutationJournalRecord }
  | { action: "return-completed"; record: MutationJournalRecord; result: IJson };

export class MutationJournal {
  constructor(
    readonly root = join(homedir(), ".cc-bridge", "journal-v1"),
    private readonly resultMaxBytes = 512 * 1024,
  ) {
    ensurePrivateDirectory(root);
  }

  prepare(decisionDigest: string, requestId: string, idempotencyKey: string, nowMs = Date.now()): JournalAdmission {
    const path = this.recordPath(decisionDigest);
    const existing = this.read(path);
    if (existing) {
      if (existing.requestId !== requestId || existing.idempotencyKey !== idempotencyKey) {
        throw new CcbError("CCB_IDEMPOTENCY_CONFLICT", "Journal decision digest is bound to a different request.");
      }
      if (existing.state === "completed") {
        if (existing.result === undefined) throw new CcbError("CCB_INTERNAL", "Completed effect journal has no stored result.");
        return { action: "return-completed", record: existing, result: existing.result };
      }
      if (existing.state === "started") {
        throw new CcbError("CCB_OUTCOME_UNKNOWN", "A previous execution started but did not durably complete.", { requestId });
      }
      return { action: "execute", record: existing };
    }

    const record: MutationJournalRecord = {
      schemaVersion: 1,
      decisionDigest,
      requestId,
      idempotencyKey,
      state: "prepared",
      preparedAtMs: nowMs,
    };
    writePrivateJsonAtomic(path, record);
    return { action: "execute", record };
  }

  markStarted(decisionDigest: string, nowMs = Date.now()): MutationJournalRecord {
    const path = this.recordPath(decisionDigest);
    const existing = this.read(path);
    if (!existing || existing.state !== "prepared") {
      if (existing?.state === "started") throw new CcbError("CCB_OUTCOME_UNKNOWN", "Effect journal is already in started state.");
      throw new CcbError("CCB_INTERNAL", "Effect journal was not prepared before execution.");
    }
    const started: MutationJournalRecord = { ...existing, state: "started", startedAtMs: nowMs };
    writePrivateJsonAtomic(path, started);
    return started;
  }

  markCompleted(decisionDigest: string, result: unknown, nowMs = Date.now()): MutationJournalRecord {
    assertIJson(result);
    const resultBytes = canonicalizeToBytes(result);
    if (resultBytes.byteLength > this.resultMaxBytes) {
      throw new CcbError("CCB_RESULT_TOO_LARGE", "Effect result exceeds the durable journal limit.", { maxBytes: this.resultMaxBytes });
    }
    const path = this.recordPath(decisionDigest);
    const existing = this.read(path);
    if (!existing || existing.state !== "started") throw new CcbError("CCB_INTERNAL", "Effect journal was not started before completion.");
    const completed: MutationJournalRecord = { ...existing, state: "completed", completedAtMs: nowMs, result };
    writePrivateJsonAtomic(path, completed);
    return completed;
  }

  private recordPath(decisionDigest: string): string {
    if (!DIGEST_PATTERN.test(decisionDigest)) throw new TypeError("invalid decision digest");
    return join(this.root, `${decisionDigest}.json`);
  }

  private read(path: string): MutationJournalRecord | undefined {
    const value = readPrivateJson(path, this.resultMaxBytes + 16 * 1024);
    if (value === undefined) return undefined;
    const parsed = JournalSchema.parse(value);
    if (parsed.result !== undefined) assertIJson(parsed.result);
    return parsed as MutationJournalRecord;
  }
}
