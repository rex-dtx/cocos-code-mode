const SENSITIVE_KEY = /^(?:.*(?:password|passwd|passphrase|secret|token|credential|authorization|cookie|privatekey|apikey)|pwd|auth|sessionid)$/i;
const MAX_NODES = 20000;
const MAX_CHARS = 2 * 1024 * 1024;
const MAX_STRING = 262144;
const MAX_KEY = 4096;
const MAX_DEPTH = 32;

/** Copy only data descriptors; tool arguments and results must never be mutated or serialized directly. */
export function snapshotLog(entry: Record<string, unknown>): Record<string, unknown> {
    let nodes = 0;
    let chars = 0;
    let limited = false;
    const ancestors = new Set<object>();
    const omit = (reason: string): string => {
        limited = true;
        return `[truncated: ${reason}]`;
    };

    const visit = (value: unknown, depth: number): unknown => {
        if (++nodes > MAX_NODES || chars >= MAX_CHARS) return omit('detail budget');
        if (typeof value === 'string') {
            const available = Math.min(MAX_STRING, MAX_CHARS - chars);
            chars += Math.min(value.length, available);
            return value.length > available ? value.slice(0, available) + omit('long string') : value;
        }
        if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
        if (typeof value !== 'object') return `[${typeof value}]`;
        try {
            if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
                return omit('binary payload');
            }
            if (ancestors.has(value)) return omit('circular reference');
            if (depth >= MAX_DEPTH) return omit('detail depth');
            const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null);
            ancestors.add(value);
            try {
                for (const key in value) {
                    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
                    if (nodes >= MAX_NODES || chars >= MAX_CHARS) {
                        if (Array.isArray(result)) result.push(omit('remaining items'));
                        else result['[truncated]'] = omit('remaining fields');
                        break;
                    }
                    if (key.length > MAX_KEY) {
                        (result as Record<string, unknown>)['[truncated key]'] = omit('long field name');
                        break;
                    }
                    chars += key.length;
                    const descriptor = Object.getOwnPropertyDescriptor(value, key);
                    const item = SENSITIVE_KEY.test(key.replace(/[^a-z0-9]/gi, ''))
                        ? '[REDACTED]'
                        : descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1) : omit('accessor');
                    Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true });
                }
            } finally {
                ancestors.delete(value);
            }
            return result;
        } catch {
            return omit('unreadable value');
        }
    };

    const snapshot = visit(entry, 0) as Record<string, unknown>;
    if (limited) snapshot.detailTruncated = true;
    return snapshot;
}
