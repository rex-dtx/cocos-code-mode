export type RequestOutcome = 'completed' | 'failed';

export interface ActiveRequestActivity {
    requestId: string;
    tool: string;
    startedAt: number;
    ageMs: number;
}

export interface FinishedRequestActivity {
    requestId: string;
    tool: string;
    outcome: RequestOutcome;
    status: number;
    finishedAt: number;
    durationMs: number;
}

export interface RequestActivitySnapshot {
    activeCount: number;
    active: ActiveRequestActivity[];
    overflowCount: number;
    lastFinished: FinishedRequestActivity | null;
}

const MAX_VISIBLE_ACTIVE = 20;
const EXCLUDED_TOOLS = new Set(['editorHandshake', 'editorSessionHeartbeat']);

interface VisibleActive {
    requestId: string;
    tool: string;
    startedAt: number;
}

/** Bounded metadata-only activity. It never retains arguments, results, prompts, or source data. */
export class RequestActivityStore {
    private activeCount = 0;
    private readonly visible = new Map<string, VisibleActive>();
    private lastFinished: FinishedRequestActivity | null = null;

    constructor(private readonly now: () => number = Date.now) {}

    start(requestId: string, tool: string): boolean {
        if (EXCLUDED_TOOLS.has(tool)) return false;
        this.activeCount += 1;
        if (this.visible.size < MAX_VISIBLE_ACTIVE) {
            this.visible.set(requestId, { requestId, tool, startedAt: this.now() });
        }
        return true;
    }

    finish(requestId: string, tool: string, outcome: RequestOutcome, status: number, startedAt: number): void {
        if (EXCLUDED_TOOLS.has(tool)) return;
        this.activeCount = Math.max(0, this.activeCount - 1);
        this.visible.delete(requestId);
        const finishedAt = this.now();
        this.lastFinished = {
            requestId,
            tool,
            outcome,
            status,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
        };
    }

    snapshot(): RequestActivitySnapshot {
        const now = this.now();
        const active = [...this.visible.values()].map((entry) => ({
            ...entry,
            ageMs: Math.max(0, now - entry.startedAt),
        }));
        return {
            activeCount: this.activeCount,
            active,
            overflowCount: Math.max(0, this.activeCount - active.length),
            lastFinished: this.lastFinished ? { ...this.lastFinished } : null,
        };
    }

    clear(): void {
        this.activeCount = 0;
        this.visible.clear();
        this.lastFinished = null;
    }
}
