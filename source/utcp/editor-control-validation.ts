import { ToolError } from './tool-error';

export function invalidControl(message: string): never {
    throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message });
}
export function controlObject(input: unknown, allowed: string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalidControl('Arguments must be an object.');
    const args = input as Record<string, unknown>;
    if (Object.keys(args).some(key => !allowed.includes(key))) invalidControl('Unsupported argument.');
    return args;
}
export function controlText(value: unknown, name: string, max: number, required = false): string {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalidControl(`${name} must be ${required ? 'non-blank ' : ''}text of at most ${max} characters.`);
    return value;
}
export function controlNumber(value: unknown, name: string, min: number, max: number, integer = true): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) invalidControl(`${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
    return value;
}
export function controlTaskId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) invalidControl('taskId must be a 32-character lowercase hexadecimal ID returned by editorProgress.');
    return value;
}
export function controlEnum<T extends string>(value: unknown, name: string, values: readonly T[]): T {
    if (!values.includes(value as T)) invalidControl(`${name} must be one of: ${values.join(', ')}.`);
    return value as T;
}
