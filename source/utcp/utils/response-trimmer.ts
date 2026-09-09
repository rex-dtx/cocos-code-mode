// ponytail: recursive trim of null/undefined/empty containers before serializing.
// Required output fields remain present when their declared value is empty.
// Optional empty containers are still removed to keep payloads compact.

export function trimResponse(value: any, schema?: any): any {
    if (value === null || value === undefined) return undefined;

    if (Array.isArray(value)) {
        const itemSchema = schema?.items;
        const trimmed = value.map(item => trimResponse(item, itemSchema)).filter(v => v !== undefined);
        return trimmed.length > 0 ? trimmed : [];
    }

    if (typeof value === 'object') {
        const result: Record<string, any> = {};
        let hasKeys = false;
        const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
        const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
        for (const key of Object.keys(value)) {
            const trimmed = trimResponse(value[key], properties[key]);
            if (trimmed !== undefined) {
                if (Array.isArray(trimmed) && trimmed.length === 0 && !required.has(key)) continue;
                if (typeof trimmed === 'object' && !Array.isArray(trimmed) && Object.keys(trimmed).length === 0 && !required.has(key)) continue;
                result[key] = trimmed;
                hasKeys = true;
            } else if (required.has(key)) {
                result[key] = value[key];
                hasKeys = true;
            }
        }
        return hasKeys ? result : undefined;
    }

    return value;
}
