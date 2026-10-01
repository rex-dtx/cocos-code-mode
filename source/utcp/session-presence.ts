import { performance } from 'perf_hooks';

export type SessionTransport = 'http-helper' | 'code-mode';
export type SessionStatus = 'Active' | 'Stale' | 'Expired';

export interface SessionPresenceSnapshot {
    sessionId: string;
    label: string | null;
    transport: SessionTransport;
    lastSeen: number;
    ageMs: number;
    status: SessionStatus;
}

export interface SessionPresenceInput {
    sessionId?: unknown;
    label?: unknown;
    expectedInstanceId?: unknown;
    transport?: unknown;
    operation?: unknown;
}

export class SessionPresenceError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(code: string, message: string, status = 400) {
        super(message);
        this.name = 'SessionPresenceError';
        this.code = code;
        this.status = status;
    }
}

type Clock = { wall: number; mono: number };
type Entry = { sessionId: string; label: string | null; transport: SessionTransport; wallLastSeen: number; monoLastSeen: number };

const ACTIVE_MS = 15000;
const STALE_MS = 60000;
const RETENTION_MS = 300000;
const MAX_SESSIONS = 100;

// An advisory declaration from the caller, not authentication or a runtime/graph session.
export class SessionPresenceStore {
    private readonly entries = new Map<string, Entry>();
    private readonly now: () => Clock;

    constructor(private readonly instanceId: string, now?: () => Clock) {
        if (typeof instanceId !== 'string' || !instanceId) throw new Error('instanceId must be non-empty.');
        this.now = now || (() => ({ wall: Date.now(), mono: performance.now() }));
    }

    heartbeat(input: unknown): SessionPresenceSnapshot {
        const args = this.validate(input);
        if (args.expectedInstanceId !== this.instanceId) {
            throw new SessionPresenceError('INSTANCE_MISMATCH', 'expectedInstanceId does not match this server instance.', 409);
        }
        const clock = this.now();
        const existing = this.entries.get(args.sessionId);
        if (args.operation === 'close') {
            if (existing) this.entries.delete(args.sessionId);
            return { sessionId: args.sessionId, label: existing?.label ?? args.label ?? null,
                transport: existing?.transport ?? args.transport, lastSeen: clock.wall, ageMs: 0, status: 'Expired' };
        }
        // Retain expired entries for inspection unless admission needs their slots.
        this.prune(clock.mono, !existing && this.entries.size >= MAX_SESSIONS);
        if (!existing && this.entries.size >= MAX_SESSIONS) {
            throw new SessionPresenceError('CAPACITY_EXCEEDED', 'Session presence capacity is full.', 429);
        }
        const entry: Entry = { sessionId: args.sessionId, label: args.label ?? existing?.label ?? null,
            transport: args.transport, wallLastSeen: clock.wall, monoLastSeen: clock.mono };
        this.entries.set(args.sessionId, entry);
        return this.toSnapshot(entry, clock.mono);
    }

    snapshot(): SessionPresenceSnapshot[] {
        const clock = this.now();
        this.prune(clock.mono, false);
        return Array.from(this.entries.values(), entry => this.toSnapshot(entry, clock.mono));
    }

    private prune(mono: number, forAdmission: boolean): void {
        const threshold = forAdmission ? STALE_MS : RETENTION_MS;
        for (const [id, entry] of this.entries) {
            if (mono - entry.monoLastSeen > threshold) this.entries.delete(id);
        }
    }

    private toSnapshot(entry: Entry, mono: number): SessionPresenceSnapshot {
        const ageMs = Math.max(0, Math.floor(mono - entry.monoLastSeen));
        const status: SessionStatus = ageMs <= ACTIVE_MS ? 'Active' : ageMs <= STALE_MS ? 'Stale' : 'Expired';
        return { sessionId: entry.sessionId, label: entry.label, transport: entry.transport,
            lastSeen: entry.wallLastSeen, ageMs, status };
    }

    private validate(input: unknown): { sessionId: string; label?: string; expectedInstanceId: string; transport: SessionTransport; operation: 'beat' | 'close' } {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new SessionPresenceError('INVALID_ARGUMENT', 'Input must be an object.');
        }
        const value = input as SessionPresenceInput;
        for (const key of Object.keys(value)) {
            if (key !== 'sessionId' && key !== 'label' && key !== 'expectedInstanceId' && key !== 'transport' && key !== 'operation') {
                throw new SessionPresenceError('INVALID_ARGUMENT', `Unknown field: ${key}.`);
            }
        }
        const text = (v: unknown, name: string, max: number): string => {
            if (typeof v !== 'string' || v.length < 1 || v.length > max || v.trim() !== v || /[\x00-\x1f\x7f]/.test(v)) {
                throw new SessionPresenceError('INVALID_ARGUMENT', `${name} must be bounded printable text without surrounding whitespace.`);
            }
            return v;
        };
        const sessionId = text(value.sessionId, 'sessionId', 128);
        const expectedInstanceId = text(value.expectedInstanceId, 'expectedInstanceId', 256);
        if (value.label !== undefined) text(value.label, 'label', 256);
        if (value.transport !== 'http-helper' && value.transport !== 'code-mode') {
            throw new SessionPresenceError('INVALID_ARGUMENT', 'transport is invalid.');
        }
        const operation = value.operation === undefined ? 'beat' : value.operation;
        if (operation !== 'beat' && operation !== 'close') {
            throw new SessionPresenceError('INVALID_ARGUMENT', 'operation is invalid.');
        }
        return { sessionId, label: value.label as string | undefined,
            expectedInstanceId, transport: value.transport, operation };
    }
}
