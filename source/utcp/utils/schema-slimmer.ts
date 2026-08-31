import { JsonSchema } from '@utcp/sdk';

export function slimOutputsSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    const slim: JsonSchema = { type: schema.type || 'object' };
    if (schema.properties) {
        slim.properties = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            const property: JsonSchema = { type: value.type || 'object' };
            if (value.const !== undefined) {
                property.const = value.const;
            }
            if (value.enum) {
                property.enum = value.enum;
            }
            slim.properties[key] = property;
        }
    }
    if (schema.required) {
        slim.required = schema.required;
    }

    return slim;
}
