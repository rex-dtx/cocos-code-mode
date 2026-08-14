// ponytail: recursive trim of null/undefined/empty containers from response objects.
// Keeps top-level keys (semantic signal) but strips values that carry no information.
// Empty arrays and empty objects are stripped because they're ambiguous — a missing key
// is clearer than "here's an empty list" for LLM consumption.

export function trimResponse(value: any): any {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const trimmed = value.map(trimResponse).filter(v => v !== undefined);
        // Keep the array even if empty — [] at root level means "no results" which IS info
        // But nested empty arrays inside objects will be stripped by the object handler below
        return trimmed.length > 0 ? trimmed : [];
    }

    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        let hasKeys = false;
        for (const key of Object.keys(value)) {
            const trimmed = trimResponse(value[key]);
            if (trimmed !== undefined) {
                // Strip empty containers at object-property level
                if (Array.isArray(trimmed) && trimmed.length === 0) continue;
                if (typeof trimmed === 'object' && !Array.isArray(trimmed) && Object.keys(trimmed).length === 0) continue;
                result[key] = trimmed;
                hasKeys = true;
            }
        }
        // If ALL properties were stripped, return undefined so parent can drop this key
        return hasKeys ? result : undefined;
    }

    return value;
}
