import { ExecuteGuard } from '../execute-types';

// Arbitrary code can return non-serializable values (cc.Node, functions, BigInt,
// circular objects) that would make res.json() throw. Coerce to a JSON-safe shape
// before the response-trimmer runs.
function toJsonSafe(value: any): any {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(value, (key, val) => {
        if (typeof val === 'function' || typeof val === 'bigint' || typeof val === 'symbol') return undefined;
        if (val && typeof val === 'object') {
            if (seen.has(val)) return undefined; // circular
            seen.add(val);
        }
        return val;
    }));
}

export const serializeGuard: ExecuteGuard = {
    name: 'serialize',
    after(_ctx, result) {
        if (result === undefined || result === null) return null;
        if (typeof result !== 'object') {
            return (typeof result === 'function' || typeof result === 'symbol' || typeof result === 'bigint')
                ? null
                : result;
        }
        try {
            JSON.stringify(result);
            return result; // already serializable — trimResponse strips empties downstream
        } catch {
            return toJsonSafe(result);
        }
    },
};
