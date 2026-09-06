import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { CcbError } from "./errors.ts";

export interface ReplayReservationInput {
  deviceId: string;
  relayInstanceId: string;
  idempotencyKey: string;
  requestDigest: string;
  nonce: string;
  sequence: number;
  nowMs: number;
  expiresAtMs: number;
}

export type ReplayAdmission =
  | { kind: "duplicate"; responseBody: Buffer }
  | { kind: "reserved"; id: number; owner: string };

type ExistingRow = {
  id: number;
  request_digest: string;
  state: "reserved" | "completed";
  response_body: Buffer | null;
  response_hash: string | null;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalRequestDigest(payload: Uint8Array): string {
  return sha256(payload);
}

export class ReplayStore {
  private readonly reserveTransaction: (input: ReplayReservationInput) => ReplayAdmission;

  constructor(private readonly db: Database.Database) {
    this.reserveTransaction = db.transaction((input: ReplayReservationInput): ReplayAdmission => {
      const duplicate = db.prepare(`
        SELECT id, request_digest, state, response_body, response_hash
        FROM request_idempotency
        WHERE device_id = ? AND idempotency_key = ?
      `).get(input.deviceId, input.idempotencyKey) as ExistingRow | undefined;

      if (duplicate) {
        if (duplicate.request_digest !== input.requestDigest) {
          throw new CcbError("CCB_IDEMPOTENCY_CONFLICT", "Idempotency key was used for different request bytes.");
        }
        if (duplicate.state !== "completed" || !duplicate.response_body || !duplicate.response_hash) {
          throw new CcbError("CCB_BUSY", "The exact request is already being processed.");
        }
        if (sha256(duplicate.response_body) !== duplicate.response_hash) {
          throw new CcbError("CCB_INTERNAL", "Stored idempotent response failed its integrity check.");
        }
        return { kind: "duplicate", responseBody: Buffer.from(duplicate.response_body) };
      }

      const cursor = db.prepare(`
        SELECT last_sequence FROM relay_cursor WHERE device_id = ? AND relay_instance_id = ?
      `).get(input.deviceId, input.relayInstanceId) as { last_sequence: number } | undefined;
      if (cursor && input.sequence <= cursor.last_sequence) {
        throw new CcbError("CCB_REPLAY", "Relay sequence did not advance.", { lastSequence: cursor.last_sequence });
      }

      const nonce = db.prepare(`
        SELECT 1 AS found FROM request_idempotency
        WHERE device_id = ? AND relay_instance_id = ? AND nonce = ?
      `).get(input.deviceId, input.relayInstanceId, input.nonce) as { found: number } | undefined;
      if (nonce) throw new CcbError("CCB_REPLAY", "Request nonce was already admitted.");

      const owner = randomUUID();
      const inserted = db.prepare(`
        INSERT INTO request_idempotency(
          device_id, relay_instance_id, idempotency_key, request_digest, nonce, sequence,
          state, reservation_owner, created_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)
      `).run(
        input.deviceId, input.relayInstanceId, input.idempotencyKey, input.requestDigest,
        input.nonce, input.sequence, owner, input.nowMs, input.expiresAtMs,
      );
      db.prepare(`
        INSERT INTO relay_cursor(device_id, relay_instance_id, last_sequence, updated_at_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(device_id, relay_instance_id) DO UPDATE SET
          last_sequence = excluded.last_sequence,
          updated_at_ms = excluded.updated_at_ms
      `).run(input.deviceId, input.relayInstanceId, input.sequence, input.nowMs);
      return { kind: "reserved", id: Number(inserted.lastInsertRowid), owner };
    });
  }


  lookupCompleted(deviceId: string, idempotencyKey: string, requestDigest: string): Buffer | null {
    const duplicate = this.db.prepare(`
      SELECT request_digest, state, response_body, response_hash
      FROM request_idempotency
      WHERE device_id = ? AND idempotency_key = ?
    `).get(deviceId, idempotencyKey) as ExistingRow | undefined;
    if (!duplicate) return null;
    if (duplicate.request_digest !== requestDigest) {
      throw new CcbError("CCB_IDEMPOTENCY_CONFLICT", "Idempotency key was used for different request bytes.");
    }
    if (duplicate.state !== "completed" || !duplicate.response_body || !duplicate.response_hash) {
      throw new CcbError("CCB_BUSY", "The exact request is already being processed.");
    }
    if (sha256(duplicate.response_body) !== duplicate.response_hash) {
      throw new CcbError("CCB_INTERNAL", "Stored idempotent response failed its integrity check.");
    }
    return Buffer.from(duplicate.response_body);
  }
  reserve(input: ReplayReservationInput): ReplayAdmission {
    try {
      return this.reserveTransaction(input);
    } catch (error) {
      if (error instanceof CcbError) throw error;
      if (error instanceof Error && error.message.includes("request_idempotency.device_id")) {
        throw new CcbError("CCB_REPLAY", "Request replay constraint rejected the request.");
      }
      throw error;
    }
  }

  complete(id: number, owner: string, responseBody: Uint8Array, nowMs: number): void {
    const body = Buffer.from(responseBody);
    const result = this.db.prepare(`
      UPDATE request_idempotency
      SET state = 'completed', response_body = ?, response_hash = ?, completed_at_ms = ?
      WHERE id = ? AND reservation_owner = ? AND state = 'reserved'
    `).run(body, sha256(body), nowMs, id, owner);
    if (result.changes !== 1) {
      throw new CcbError("CCB_INTERNAL", "Could not durably complete the request reservation.");
    }
  }
}
