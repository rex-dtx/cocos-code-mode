import type Database from "better-sqlite3";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE device (
        id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        public_key_spki BLOB NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')),
        created_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER,
        revoked_at_ms INTEGER
      );

      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        display_label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE grant_record (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        device_id TEXT,
        project_id TEXT,
        tool_id TEXT,
        operation_class TEXT NOT NULL CHECK (operation_class IN ('read', 'mutation', 'capture', 'control')),
        expires_at_ms INTEGER,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
        created_at_ms INTEGER NOT NULL,
        CHECK (member_id IS NOT NULL OR device_id IS NOT NULL)
      );

      CREATE TABLE operation_policy (
        tool_id TEXT NOT NULL,
        contract_version INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        contract_hash TEXT NOT NULL,
        minimum_relay_build TEXT,
        blocked_relay_builds_json TEXT NOT NULL DEFAULT '[]',
        creator_range TEXT NOT NULL,
        required_consent_version TEXT,
        revision INTEGER NOT NULL,
        PRIMARY KEY (tool_id, contract_version)
      );

      CREATE TABLE relay_cursor (
        device_id TEXT NOT NULL,
        relay_instance_id TEXT NOT NULL,
        last_sequence INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (device_id, relay_instance_id)
      );

      CREATE TABLE request_idempotency (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        relay_instance_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        nonce TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved', 'completed')),
        reservation_owner TEXT NOT NULL,
        response_body BLOB,
        response_hash TEXT,
        created_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        expires_at_ms INTEGER NOT NULL,
        UNIQUE (device_id, idempotency_key),
        UNIQUE (device_id, relay_instance_id, nonce),
        CHECK ((state = 'reserved' AND response_body IS NULL AND response_hash IS NULL AND completed_at_ms IS NULL)
          OR (state = 'completed' AND response_body IS NOT NULL AND response_hash IS NOT NULL AND completed_at_ms IS NOT NULL))
      );

      CREATE TABLE release_target (
        sequence INTEGER PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        package_hash TEXT NOT NULL UNIQUE,
        compatibility_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'revoked')),
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE rollout_policy (
        sequence INTEGER PRIMARY KEY,
        target_hash TEXT NOT NULL,
        channel TEXT NOT NULL,
        ring TEXT NOT NULL,
        percentage INTEGER NOT NULL CHECK (percentage BETWEEN 0 AND 100),
        minimum_build TEXT,
        blocked_builds_json TEXT NOT NULL DEFAULT '[]',
        rollback_target_hash TEXT,
        expires_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE cc_bridge_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        member_id TEXT,
        device_id TEXT,
        project_id TEXT,
        tool_family TEXT NOT NULL,
        relay_build TEXT,
        result_class TEXT NOT NULL,
        error_code TEXT,
        request_bytes INTEGER NOT NULL,
        response_bytes INTEGER NOT NULL,
        phase_timings_json TEXT NOT NULL
      );

      CREATE INDEX device_member_status_idx ON device(member_id, status);
      CREATE INDEX grant_active_idx ON grant_record(status, member_id, device_id, project_id, tool_id, expires_at_ms);
      CREATE INDEX operation_policy_enabled_idx ON operation_policy(enabled, tool_id, contract_version);
      CREATE INDEX replay_expiry_idx ON request_idempotency(expires_at_ms, state);
      CREATE INDEX release_status_idx ON release_target(status, version);
      CREATE INDEX rollout_channel_idx ON rollout_policy(channel, ring, expires_at_ms);
      CREATE INDEX cc_bridge_audit_time_idx ON cc_bridge_audit(timestamp_ms);
      CREATE INDEX cc_bridge_audit_tool_status_idx ON cc_bridge_audit(tool_family, result_class, timestamp_ms);
    `,
  },
];

export function applyCcBridgeMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cc_bridge_migration (
      version INTEGER PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    )
  `);
  const applied = db.prepare("SELECT version FROM cc_bridge_migration").all() as Array<{ version: number }>;
  const versions = new Set(applied.map((row) => row.version));
  const migrate = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare("INSERT INTO cc_bridge_migration(version, applied_at_ms) VALUES (?, ?)")
      .run(migration.version, Date.now());
  });
  for (const migration of MIGRATIONS) {
    if (!versions.has(migration.version)) migrate(migration);
  }
}
