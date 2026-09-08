export type RuntimeTargetKind = 'game-view' | 'browser-preview' | 'simulator';
export type RuntimeSessionStatus = 'attached' | 'stopped';

export interface RuntimeSession {
    sessionId: string;
    targetKind: RuntimeTargetKind;
    targetId: string;
    status: RuntimeSessionStatus;
    createdAt: number;
    stoppedAt?: number;
}

export class RuntimeSessionError extends Error {
    constructor(
        public readonly code: 'INVALID_ARGUMENT' | 'SESSION_NOT_FOUND' | 'SESSION_LIMIT',
        message: string,
    ) {
        super(message);
        this.name = 'RuntimeSessionError';
    }
}

const DEFAULT_MAX_SESSIONS = 8;
const MAX_TARGET_ID_LENGTH = 256;

export class RuntimeSessionStore {
    private readonly sessions = new Map<string, RuntimeSession>();
    private nextId = 1;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly maxSessions: number = DEFAULT_MAX_SESSIONS,
    ) {
        if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > DEFAULT_MAX_SESSIONS) {
            throw new RuntimeSessionError('INVALID_ARGUMENT', `maxSessions must be an integer from 1 to ${DEFAULT_MAX_SESSIONS}`);
        }
    }

    attach(targetKind: RuntimeTargetKind, targetId: string): RuntimeSession {
        this.validateTarget(targetKind, targetId);
        const existing = [...this.sessions.values()].find((session) => (
            session.targetKind === targetKind && session.targetId === targetId && session.status === 'attached'
        ));
        if (existing) return this.clone(existing);

        if (this.sessions.size >= this.maxSessions) {
            throw new RuntimeSessionError('SESSION_LIMIT', `Runtime session limit reached (${this.maxSessions})`);
        }

        const session: RuntimeSession = {
            sessionId: `runtime-${this.nextId++}`,
            targetKind,
            targetId,
            status: 'attached',
            createdAt: this.now(),
        };
        this.sessions.set(session.sessionId, session);
        return this.clone(session);
    }

    inspect(sessionId: string): RuntimeSession {
        const session = this.require(sessionId);
        return this.clone(session);
    }

    stop(sessionId: string): RuntimeSession {
        const session = this.require(sessionId);
        if (session.status === 'attached') {
            session.status = 'stopped';
            session.stoppedAt = this.now();
        }
        return this.clone(session);
    }

    reset(sessionId: string): { sessionId: string, reset: true } {
        this.require(sessionId);
        this.sessions.delete(sessionId);
        return { sessionId, reset: true };
    }

    list(): RuntimeSession[] {
        return [...this.sessions.values()].map((session) => this.clone(session));
    }

    private require(sessionId: string): RuntimeSession {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            throw new RuntimeSessionError('INVALID_ARGUMENT', 'sessionId is required');
        }
        const session = this.sessions.get(sessionId);
        if (!session) throw new RuntimeSessionError('SESSION_NOT_FOUND', `Runtime session not found: ${sessionId}`);
        return session;
    }

    private validateTarget(targetKind: RuntimeTargetKind, targetId: string): void {
        if (!['game-view', 'browser-preview', 'simulator'].includes(targetKind)) {
            throw new RuntimeSessionError('INVALID_ARGUMENT', `Unsupported runtime target kind: ${String(targetKind)}`);
        }
        if (typeof targetId !== 'string' || targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) {
            throw new RuntimeSessionError('INVALID_ARGUMENT', `targetId must be 1-${MAX_TARGET_ID_LENGTH} characters`);
        }
    }

    private clone(session: RuntimeSession): RuntimeSession {
        return { ...session };
    }
}
