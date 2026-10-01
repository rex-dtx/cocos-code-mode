import type { JsonSchema } from '@utcp/sdk';

// Preserve declared required output fields, including empty arrays and objects.
// Optional empty containers still disappear to keep normal responses compact.
export function trimResponse(value: unknown, schema?: JsonSchema): unknown {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
        const trimmed = value.map(item => trimResponse(item, schema?.items as JsonSchema | undefined)).filter(item => item !== undefined);
        return trimmed.length ? trimmed : [];
    }
    if (typeof value === 'object') {
        const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
        const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
        const record = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(record)) {
            const trimmed = trimResponse(record[key], properties[key] as JsonSchema | undefined);
            if (trimmed === undefined) continue;
            if (Array.isArray(trimmed) && trimmed.length === 0 && !required.has(key)) continue;
            if (trimmed !== null && typeof trimmed === 'object' && !Array.isArray(trimmed) && Object.keys(trimmed).length === 0 && !required.has(key)) continue;
            result[key] = trimmed;
        }
        return Object.keys(result).length ? result : undefined;
    }
    return value;
}
