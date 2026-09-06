import { describe, expect, it } from "vitest";
import { recordCcBridgeAudit, type CcBridgeAuditRow } from "../../src/cc-bridge/audit.ts";
import { CcBridgeStore } from "../../src/cc-bridge/store.ts";

describe("CC Bridge audit", () => {
  it("stores metadata only — no observation, screenshot, or result body", () => {
    const store = new CcBridgeStore(":memory:");
    const row: CcBridgeAuditRow = {
      correlationId: "corr-1",
      memberId: "member-1",
      deviceId: "device-1",
      projectId: "project-1",
      toolFamily: "createUiNode",
      resultClass: "ok",
      requestBytes: 128,
      responseBytes: 256,
      phaseTimings: { authorize: 1, plan: 2 },
    };
    recordCcBridgeAudit(store, row, 1);
    const stored = store.db.prepare("SELECT * FROM cc_bridge_audit").get() as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual([
      "correlation_id", "device_id", "error_code", "id", "member_id",
      "phase_timings_json", "project_id", "relay_build", "request_bytes",
      "response_bytes", "result_class", "timestamp_ms", "tool_family",
    ].sort());
    expect(JSON.stringify(stored)).not.toMatch(/observation|screenshot|parentUuid|scene-root/);
  });
});
