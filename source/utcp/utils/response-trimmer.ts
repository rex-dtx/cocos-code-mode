// ponytail: recursive trim of null/undefined/empty containers before serializing.
// Required output fields remain present when their declared value is empty.
// Optional empty containers are still removed to keep payloads compact.

function schemaForValue(value: unknown, schema: any): any {
    if (!schema || typeof schema !== 'object' || !Array.isArray(schema.oneOf ?? schema.anyOf)) return schema;
    const alternatives = schema.oneOf ?? schema.anyOf;
    const selected = alternatives.find((alternative: any) => Array.isArray(alternative?.required)
        && alternative.required.every((key: unknown) => typeof key === 'string' && !!value && typeof value === 'object' && key in value));
    return selected ? { ...schema, ...selected, properties: schema.properties } : schema;
}

export function trimResponse(value: any, schema?: any): any {
    schema = schemaForValue(value, schema);
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
