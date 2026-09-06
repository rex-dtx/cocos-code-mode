export interface SchemaValidationError {
    path: string;
    keyword: string;
    message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lightweight input guard for UTCP handlers.
 * GET query values are strings, so this checks required + enum only — not JSON types.
 */
export function validateSchemaArguments(schema: unknown, args: unknown): SchemaValidationError[] {
    const errors: SchemaValidationError[] = [];
    if (!isPlainObject(schema)) {
        return errors;
    }
    const objectValue = isPlainObject(args) ? args : {};
    const required = Array.isArray(schema.required)
        ? schema.required.filter((property): property is string => typeof property === 'string')
        : [];
    for (const property of required) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, property)
            || objectValue[property] === undefined
            || objectValue[property] === null
            || objectValue[property] === '') {
            errors.push({ path: property, keyword: 'required', message: 'Required property is missing.' });
        }
    }
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [property, propertySchema] of Object.entries(properties)) {
        if (!Object.prototype.hasOwnProperty.call(objectValue, property) || objectValue[property] === undefined) {
            continue;
        }
        if (!isPlainObject(propertySchema) || !Array.isArray(propertySchema.enum)) {
            continue;
        }
        const value = objectValue[property];
        const allowed = propertySchema.enum;
        if (!allowed.some((candidate) => candidate === value || String(candidate) === String(value))) {
            errors.push({ path: property, keyword: 'enum', message: 'Must equal one of the declared values.' });
        }
    }
    return errors;
}

export function findMissingRequiredInputs(schema: unknown, args: Record<string, unknown>): string[] {
    return validateSchemaArguments(schema, args)
        .filter((error) => error.keyword === 'required' && !error.path.includes('.') && !error.path.includes('['))
        .map((error) => error.path);
}
