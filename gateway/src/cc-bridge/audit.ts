import type { CcBridgeStore } from "./store.ts";

export interface CcBridgeAuditRow {
  correlationId: string;
  memberId?: string;
  deviceId?: string;
  projectId?: string;
  toolFamily: string;
  relayBuild?: string;
  resultClass: "ok" | "deny" | "error";
  errorCode?: string;
  requestBytes: number;
  responseBytes: number;
  phaseTimings: Record<string, number>;
}

export function recordCcBridgeAudit(store: CcBridgeStore, row: CcBridgeAuditRow, nowMs = Date.now()): void {
  store.db.prepare(`
    INSERT INTO cc_bridge_audit(
      correlation_id, timestamp_ms, member_id, device_id, project_id, tool_family,
      relay_build, result_class, error_code, request_bytes, response_bytes, phase_timings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.correlationId, nowMs, row.memberId ?? null, row.deviceId ?? null, row.projectId ?? null,
    row.toolFamily, row.relayBuild ?? null, row.resultClass, row.errorCode ?? null,
    row.requestBytes, row.responseBytes, JSON.stringify(row.phaseTimings),
  );
}
