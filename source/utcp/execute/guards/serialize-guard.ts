import { ExecuteGuard } from '../execute-types';

function toJsonSafe(value: unknown): unknown {
    const seen = new WeakSet<object>();
    return JSON.parse(JSON.stringify(value, (_key, val: unknown) => {
        if (typeof val === 'function' || typeof val === 'bigint' || typeof val === 'symbol') return undefined;
        if (val && typeof val === 'object') {
            if (seen.has(val)) return undefined;
            seen.add(val);
        }
        return val;
    }));
}

export const serializeGuard: ExecuteGuard = {
    name: 'serialize',
    after(_ctx, result: unknown) {
        if (result === undefined || result === null) return null;
        if (typeof result !== 'object') {
            return (typeof result === 'function' || typeof result === 'symbol' || typeof result === 'bigint')
                ? null
                : result;
        }
        try {
            JSON.stringify(result);
            return result;
        } catch {
            return toJsonSafe(result);
        }
    },
};
