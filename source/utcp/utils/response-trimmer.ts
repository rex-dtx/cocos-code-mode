// ponytail: recursive trim of null/undefined/empty containers from response objects.
// Keeps top-level keys (semantic signal) but strips values that carry no information.

export function trimResponse(value: any): any {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const trimmed = value.map(trimResponse).filter(v => v !== undefined);
        return trimmed.length > 0 ? trimmed : [];
    }

    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        let hasKeys = false;
        for (const key of Object.keys(value)) {
            const trimmed = trimResponse(value[key]);
            if (trimmed !== undefined) {
                if (Array.isArray(trimmed) && trimmed.length === 0) continue;
                if (typeof trimmed === 'object' && !Array.isArray(trimmed) && Object.keys(trimmed).length === 0) continue;
                result[key] = trimmed;
                hasKeys = true;
            }
        }
        return hasKeys ? result : undefined;
    }

    return value;
}
