// Shared TTL memo for cross-request caching (M4 — L1 layer).
// Scene state changes fast and must NOT be cached cross-request; only
// near-static data (TS definitions, editor vocabularies) belongs here.
// See cache-batch plan: L1 definition (TTL 60s), L2 asset query (TTL 5s).

interface MemoEntry {
    value: unknown;
    expiresAt: number;
}

export class TtlMemo {
    private store = new Map<string, MemoEntry>();
    private readonly ttlMs: number;
    private readonly maxEntries: number;

    constructor(ttlMs: number, maxEntries = 256) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
    }

    get<T = unknown>(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value as T;
    }

    set(key: string, value: unknown): void {
        // Simple eviction: drop oldest when over cap (Map preserves insertion order).
        if (this.store.size >= this.maxEntries) {
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }

    invalidate(key?: string): void {
        if (key === undefined) this.store.clear();
        else this.store.delete(key);
    }

    get size(): number {
        return this.store.size;
    }
}

// Pre-tuned instances for the documented cache tiers.
export const definitionMemo = new TtlMemo(60_000);   // L1: TS definitions, 60s
export const assetQueryMemo = new TtlMemo(5_000);    // L2: asset query, 5s

/** Canonical L2 key — same shape queryAssetsCompat stores under. */
export function assetQueryKey(options: { pattern?: string } & Record<string, unknown>): string {
    return JSON.stringify(options);
}

/**
 * Evict cross-request caches after a mutation.
 * `keys` are exact L2 query keys known to be stale; when omitted the whole L2 store clears.
 * L1 always clears — a script/prefab write can change any class definition.
 */
export function invalidateAfterWrite(keys?: string | string[]): void {
    definitionMemo.invalidate();
    if (keys === undefined) {
        assetQueryMemo.invalidate();
        return;
    }
    for (const k of Array.isArray(keys) ? keys : [keys]) assetQueryMemo.invalidate(k);
}
