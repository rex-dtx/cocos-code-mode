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

type Entry = { sessionId: string; label: string | null; transport: SessionTransport; wallLastSeen: number; monoLastSeen: number };

export class SessionPresenceStore {
    private readonly entries = new Map<string, Entry>();
    private readonly now: () => { wall: number; mono: number };
    constructor(private readonly instanceId: string, now?: (() => number) | (() => { wall: number; mono: number })) {
        if (typeof instanceId !== 'string' || instanceId.length === 0) throw new Error('instanceId must be non-empty.');
        this.now = () => {
            const value = now ? now() : { wall: Date.now(), mono: performance.now() };
            return typeof value === 'number' ? { wall: value, mono: value } : value;
        };
    }

    heartbeat(input: unknown): SessionPresenceSnapshot {
        const args = this.validate(input);
        const clock = this.now();
        if (args.expectedInstanceId !== this.instanceId) throw new SessionPresenceError('INSTANCE_MISMATCH', 'expectedInstanceId does not match this server instance.', 409);
        this.prune(clock.mono, args.operation === 'beat' && !this.entries.has(args.sessionId) && this.entries.size >= 100);
        const existing = this.entries.get(args.sessionId);
        if (args.operation === 'close') {
            if (existing) this.entries.delete(args.sessionId);
            return { sessionId: args.sessionId, label: existing?.label ?? args.label ?? null, transport: existing?.transport ?? args.transport, lastSeen: clock.wall, ageMs: 0, status: 'Expired' };
        }
        const entry: Entry = { sessionId: args.sessionId, label: args.label ?? existing?.label ?? null, transport: args.transport, wallLastSeen: clock.wall, monoLastSeen: clock.mono };
        if (!existing && this.entries.size >= 100) throw new SessionPresenceError('CAPACITY_EXCEEDED', 'Session presence capacity is full.', 429);
        this.entries.set(args.sessionId, entry);
        return this.toSnapshot(entry, clock.mono);
    }

    snapshot(): SessionPresenceSnapshot[] {
        const clock = this.now();
        this.prune(clock.mono);
        return Array.from(this.entries.values()).map(entry => this.toSnapshot(entry, clock.mono));
    }

    private prune(now: number, forAdmission = false) { for (const [id, entry] of this.entries) if (now - entry.monoLastSeen > (forAdmission ? 60000 : 300000)) this.entries.delete(id); }
    private toSnapshot(entry: Entry, mono: number): SessionPresenceSnapshot {
        const ageMs = Math.max(0, Math.floor(mono - entry.monoLastSeen));
        return { sessionId: entry.sessionId, label: entry.label, transport: entry.transport, lastSeen: entry.wallLastSeen, ageMs, status: ageMs <= 15000 ? 'Active' : ageMs <= 60000 ? 'Stale' : 'Expired' };
    }
    private validate(input: unknown): { sessionId: string; label?: string; expectedInstanceId: string; transport: SessionTransport; operation: 'beat' | 'close' } {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SessionPresenceError('INVALID_ARGUMENT', 'Input must be an object.');
        const value = input as SessionPresenceInput;
        const allowed = new Set(['sessionId', 'label', 'expectedInstanceId', 'transport', 'operation']);
        for (const key of Object.keys(value)) if (!allowed.has(key)) throw new SessionPresenceError('INVALID_ARGUMENT', `Unknown field: ${key}.`);
        const text = (v: unknown, name: string, max: number) => { if (typeof v !== 'string' || v.length < 1 || v.length > max || v.trim() !== v || /[\x00-\x1f\x7f]/.test(v)) throw new SessionPresenceError('INVALID_ARGUMENT', `${name} must be bounded printable text without surrounding whitespace.`); return v; };
        const sessionId = text(value.sessionId, 'sessionId', 128);
        const expectedInstanceId = text(value.expectedInstanceId, 'expectedInstanceId', 256);
        if (value.label !== undefined && value.label !== null) text(value.label, 'label', 256);
        if (value.transport !== 'http-helper' && value.transport !== 'code-mode') throw new SessionPresenceError('INVALID_ARGUMENT', 'transport is invalid.');
        if (value.label === null) throw new SessionPresenceError('INVALID_ARGUMENT', 'label must be omitted or a string.');
        const operation = value.operation === undefined ? 'beat' : value.operation;
        if (operation !== 'beat' && operation !== 'close') throw new SessionPresenceError('INVALID_ARGUMENT', 'operation is invalid.');
        return { sessionId, label: value.label as string | undefined, expectedInstanceId, transport: value.transport, operation };
    }
}
