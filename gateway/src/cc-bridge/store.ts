import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getCacheBaseDir } from "../cache-paths.ts";
import { applyCcBridgeMigrations } from "./migrations.ts";

export type DeviceStatus = "pending" | "approved" | "revoked";
export type OperationClass = "read" | "mutation" | "capture" | "control";

export interface DeviceRecord {
  id: string;
  keyId: string;
  memberId: string;
  publicKeySpki: Buffer;
  fingerprint: string;
  label: string;
  status: DeviceStatus;
}

export interface ProjectRecord {
  id: string;
  displayLabel: string;
  status: "active" | "disabled";
}

export interface GrantRecord {
  id: string;
  memberId: string | null;
  deviceId: string | null;
  projectId: string | null;
  toolId: string | null;
  operationClass: OperationClass;
  expiresAtMs: number | null;
  status: "active" | "disabled" | "revoked";
}

export interface OperationPolicyRecord {
  toolId: string;
  contractVersion: number;
  enabled: boolean;
  contractHash: string;
  minimumRelayBuild: string | null;
  blockedRelayBuilds: readonly string[];
  creatorRange: string;
  requiredConsentVersion: string | null;
  revision: number;
}

type DeviceRow = {
  id: string; key_id: string; member_id: string; public_key_spki: Buffer;
  fingerprint: string; label: string; status: DeviceStatus;
};
type ProjectRow = { id: string; display_label: string; status: ProjectRecord["status"] };
type GrantRow = {
  id: string; member_id: string | null; device_id: string | null; project_id: string | null;
  tool_id: string | null; operation_class: OperationClass; expires_at_ms: number | null; status: GrantRecord["status"];
};
type PolicyRow = {
  tool_id: string; contract_version: number; enabled: number; contract_hash: string;
  minimum_relay_build: string | null; blocked_relay_builds_json: string; creator_range: string;
  required_consent_version: string | null; revision: number;
};

function parseStringArray(json: string): readonly string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("invalid string-array JSON in CC Bridge store");
  }
  return parsed;
}

export class CcBridgeStore {
  readonly db: Database.Database;

  constructor(file = process.env.CCB_DB_PATH || path.join(getCacheBaseDir(), "cc-bridge.db")) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    applyCcBridgeMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  getDeviceByKeyId(keyId: string): DeviceRecord | null {
    const row = this.db.prepare(`
      SELECT id, key_id, member_id, public_key_spki, fingerprint, label, status
      FROM device WHERE key_id = ?
    `).get(keyId) as DeviceRow | undefined;
    return row ? {
      id: row.id, keyId: row.key_id, memberId: row.member_id,
      publicKeySpki: row.public_key_spki, fingerprint: row.fingerprint,
      label: row.label, status: row.status,
    } : null;
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.db.prepare("SELECT id, display_label, status FROM project WHERE id = ?")
      .get(id) as ProjectRow | undefined;
    return row ? { id: row.id, displayLabel: row.display_label, status: row.status } : null;
  }

  getOperationPolicy(toolId: string, contractVersion: number): OperationPolicyRecord | null {
    const row = this.db.prepare(`
      SELECT tool_id, contract_version, enabled, contract_hash, minimum_relay_build,
             blocked_relay_builds_json, creator_range, required_consent_version, revision
      FROM operation_policy WHERE tool_id = ? AND contract_version = ?
    `).get(toolId, contractVersion) as PolicyRow | undefined;
    return row ? {
      toolId: row.tool_id, contractVersion: row.contract_version, enabled: row.enabled === 1,
      contractHash: row.contract_hash, minimumRelayBuild: row.minimum_relay_build,
      blockedRelayBuilds: parseStringArray(row.blocked_relay_builds_json),
      creatorRange: row.creator_range, requiredConsentVersion: row.required_consent_version,
      revision: row.revision,
    } : null;
  }

  findActiveGrants(input: {
    memberId: string;
    deviceId: string;
    projectId: string;
    toolId: string;
    operationClass: OperationClass;
    nowMs: number;
  }): GrantRecord[] {
    const rows = this.db.prepare(`
      SELECT id, member_id, device_id, project_id, tool_id, operation_class, expires_at_ms, status
      FROM grant_record
      WHERE status = 'active'
        AND (expires_at_ms IS NULL OR expires_at_ms > @nowMs)
        AND (member_id IS NULL OR member_id = @memberId)
        AND (device_id IS NULL OR device_id = @deviceId)
        AND (project_id IS NULL OR project_id = @projectId)
        AND (tool_id IS NULL OR tool_id = @toolId)
        AND operation_class = @operationClass
    `).all(input) as GrantRow[];
    return rows.map((row) => ({
      id: row.id, memberId: row.member_id, deviceId: row.device_id,
      projectId: row.project_id, toolId: row.tool_id, operationClass: row.operation_class,
      expiresAtMs: row.expires_at_ms, status: row.status,
    }));
  }

  markDeviceSeen(deviceId: string, nowMs: number): void {
    this.db.prepare("UPDATE device SET last_seen_at_ms = ? WHERE id = ? AND status = 'approved'")
      .run(nowMs, deviceId);
  }

  insertDevice(record: DeviceRecord, nowMs = Date.now()): void {
    this.db.prepare(`
      INSERT INTO device(id, key_id, member_id, public_key_spki, fingerprint, label, status, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.keyId, record.memberId, record.publicKeySpki, record.fingerprint, record.label, record.status, nowMs);
  }

  insertProject(record: ProjectRecord, nowMs = Date.now()): void {
    this.db.prepare("INSERT INTO project(id, display_label, status, created_at_ms) VALUES (?, ?, ?, ?)")
      .run(record.id, record.displayLabel, record.status, nowMs);
  }

  insertGrant(record: GrantRecord, nowMs = Date.now()): void {
    this.db.prepare(`
      INSERT INTO grant_record(id, member_id, device_id, project_id, tool_id, operation_class, expires_at_ms, status, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.memberId, record.deviceId, record.projectId, record.toolId, record.operationClass, record.expiresAtMs, record.status, nowMs);
  }

  insertOperationPolicy(record: OperationPolicyRecord): void {
    this.db.prepare(`
      INSERT INTO operation_policy(
        tool_id, contract_version, enabled, contract_hash, minimum_relay_build,
        blocked_relay_builds_json, creator_range, required_consent_version, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.toolId, record.contractVersion, record.enabled ? 1 : 0, record.contractHash,
      record.minimumRelayBuild, JSON.stringify(record.blockedRelayBuilds), record.creatorRange,
      record.requiredConsentVersion, record.revision,
    );
  }

  approveDevice(deviceId: string, nowMs = Date.now()): boolean {
    return this.db.prepare("UPDATE device SET status = 'approved', last_seen_at_ms = ? WHERE id = ? AND status = 'pending'")
      .run(nowMs, deviceId).changes === 1;
  }

  revokeDevice(deviceId: string, nowMs = Date.now()): boolean {
    return this.db.prepare("UPDATE device SET status = 'revoked', revoked_at_ms = ? WHERE id = ? AND status != 'revoked'")
      .run(nowMs, deviceId).changes === 1;
  }

  listDevices(): DeviceRecord[] {
    const rows = this.db.prepare("SELECT id, key_id, member_id, public_key_spki, fingerprint, label, status FROM device ORDER BY created_at_ms DESC").all() as DeviceRow[];
    return rows.map((row) => ({
      id: row.id, keyId: row.key_id, memberId: row.member_id, publicKeySpki: row.public_key_spki,
      fingerprint: row.fingerprint, label: row.label, status: row.status,
    }));
  }

  listGrants(): GrantRecord[] {
    const rows = this.db.prepare("SELECT id, member_id, device_id, project_id, tool_id, operation_class, expires_at_ms, status FROM grant_record ORDER BY created_at_ms DESC").all() as GrantRow[];
    return rows.map((row) => ({
      id: row.id, memberId: row.member_id, deviceId: row.device_id, projectId: row.project_id,
      toolId: row.tool_id, operationClass: row.operation_class, expiresAtMs: row.expires_at_ms, status: row.status,
    }));
  }

  revokeGrant(grantId: string, nowMs = Date.now()): boolean {
    return this.db.prepare("UPDATE grant_record SET status = 'revoked' WHERE id = ? AND status != 'revoked'").run(grantId).changes === 1;
  }

  counts(): { activeDevices: number; replayRows: number } {
    const active = this.db.prepare("SELECT COUNT(*) AS count FROM device WHERE status = 'approved'")
      .get() as { count: number };
    const replay = this.db.prepare("SELECT COUNT(*) AS count FROM request_idempotency").get() as { count: number };
    return { activeDevices: active.count, replayRows: replay.count };
  }

  cleanupExpired(nowMs: number, limit = 500): number {
    return this.db.prepare(`
      DELETE FROM request_idempotency WHERE id IN (
        SELECT id FROM request_idempotency WHERE expires_at_ms <= ? ORDER BY expires_at_ms LIMIT ?
      )
    `).run(nowMs, limit).changes;
  }
}
