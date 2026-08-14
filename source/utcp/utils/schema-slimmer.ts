import { JsonSchema } from '@utcp/sdk';

// ponytail: strip nested depth from an OUTPUTS JsonSchema, keep top-level keys + types.
// Outputs schemas are shape hints for the LLM (what keys come back); nested property
// detail is bloat that costs tokens on every API call. Inputs schemas are NOT touched —
// Claude needs full input detail to construct correct calls.
export function slimOutputsSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
    if (!schema || typeof schema !== 'object') return schema;

    const s = schema as any;
    const slim: any = { type: s.type || 'object' };

    if (s.properties && typeof s.properties === 'object') {
        slim.properties = {};
        for (const key of Object.keys(s.properties)) {
            const val = s.properties[key];
            if (val && typeof val === 'object') {
                const p: any = { type: val.type || 'object' };
                // keep const/enum — small, high signal for the LLM
                if (val.const !== undefined) p.const = val.const;
                if (val.enum) p.enum = val.enum;
                slim.properties[key] = p;
            } else {
                slim.properties[key] = val;
            }
        }
    }

    if (Array.isArray(s.required)) slim.required = s.required;
    return slim;
}
