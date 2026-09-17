import type { CcBridgeStore } from "./store.ts";
import { retainAdminMetadata } from "./admin-audit.ts";

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
  store.db.transaction(() => {
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
    store.db.prepare(`INSERT INTO cc_bridge_usage_hour
      (hour_ms, member_id, device_id, project_id, tool_family, relay_build, result_class, error_code, requests, request_bytes, response_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT DO UPDATE SET requests = requests + 1,
        request_bytes = request_bytes + excluded.request_bytes, response_bytes = response_bytes + excluded.response_bytes
    `).run(nowMs - nowMs % 3_600_000, row.memberId ?? "", row.deviceId ?? "", row.projectId ?? "",
      row.toolFamily, row.relayBuild ?? "", row.resultClass, row.errorCode ?? "", row.requestBytes, row.responseBytes);
  })();
  retainAdminMetadata(store, nowMs);
}
