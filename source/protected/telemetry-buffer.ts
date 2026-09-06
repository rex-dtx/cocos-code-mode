import type { CompletionTelemetry } from "./protocol";
import { PRIOR_TELEMETRY_MAX_RECORDS } from "./protocol";

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export class TelemetryBuffer {
  private readonly records: CompletionTelemetry[] = [];

  push(record: CompletionTelemetry): void {
    if (!Number.isSafeInteger(record.durationMs) || record.durationMs < 0 || record.durationMs > 300_000) return;
    if (record.errorCode !== undefined && !ERROR_CODE_PATTERN.test(record.errorCode)) return;
    this.records.push({ ...record });
    if (this.records.length > PRIOR_TELEMETRY_MAX_RECORDS) this.records.shift();
  }

  take(): CompletionTelemetry[] | undefined {
    if (this.records.length === 0) return undefined;
    return this.records.splice(0, PRIOR_TELEMETRY_MAX_RECORDS);
  }

  restore(records: CompletionTelemetry[] | undefined): void {
    if (!records) return;
    for (const record of records.slice(-PRIOR_TELEMETRY_MAX_RECORDS)) this.push(record);
  }
}
