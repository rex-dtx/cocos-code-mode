import { EditorAskArgs, EditorPromptArgs, EditorPromptField } from './editor-interaction-contracts';
import { ToolError } from './tool-error';

function invalid(message: string): never {
    throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message });
}
function object(value: unknown, keys: string[], name: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) {
        invalid(`${name} must be an object with only supported properties.`);
    }
}
function text(value: unknown, name: string, max: number, allowEmpty = false): asserts value is string {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
        invalid(`${name} must be ${allowEmpty ? '0' : '1'}-${max} characters${allowEmpty ? '' : ' and non-blank'}.`);
    }
}
function integer(value: unknown, name: string, min: number, max: number): asserts value is number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${name} must be an integer from ${min} to ${max}.`);
}
function choices(value: unknown, name: string, count: number, length: number): asserts value is string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > count) invalid(`${name} must contain 1-${count} choices.`);
    for (const item of value) text(item, name, length);
    if (new Set(value).size !== value.length) invalid(`${name} choices must be unique.`);
}
function common(args: Record<string, unknown>): void {
    text(args.title, 'title', 256);
    text(args.message, 'message', 4096);
    if (args.timeoutMs !== undefined) integer(args.timeoutMs, 'timeoutMs', 1, 300000);
    if (args.openPanel !== undefined && typeof args.openPanel !== 'boolean') invalid('openPanel must be boolean.');
}
export function validateAsk(args: EditorAskArgs): EditorAskArgs & { buttons: string[]; cancelId: number; timeoutMs: number } {
    object(args, ['title', 'message', 'detail', 'type', 'buttons', 'cancelId', 'timeoutMs', 'presentation', 'openPanel'], 'editorAsk');
    common(args);
    if (args.detail !== undefined) text(args.detail, 'detail', 8192, true);
    if (args.type !== undefined && !['info', 'warning', 'error', 'question'].includes(args.type)) invalid('Unsupported dialog type.');
    if (args.presentation !== undefined && !['panel', 'native'].includes(args.presentation)) invalid('presentation must be panel or native.');
    const buttons = args.buttons === undefined ? ['OK', 'Cancel'] : args.buttons;
    choices(buttons, 'buttons', 8, 80);
    const cancelId = args.cancelId === undefined ? buttons.length - 1 : args.cancelId;
    integer(cancelId, 'cancelId', 0, buttons.length - 1);
    return { ...args, buttons: [...buttons], cancelId, timeoutMs: args.timeoutMs ?? 60000 };
}
export function validatePrompt(args: EditorPromptArgs): EditorPromptArgs & { timeoutMs: number } {
    object(args, ['title', 'message', 'fields', 'timeoutMs', 'openPanel'], 'editorPrompt');
    common(args);
    if (!Array.isArray(args.fields) || args.fields.length < 1 || args.fields.length > 16) invalid('fields must contain 1-16 fields.');
    const names = new Set<string>();
    const fields = args.fields.map((field: EditorPromptField) => {
        object(field, ['name', 'label', 'type', 'required', 'defaultValue', ...(field?.type === 'text' ? ['maxLength'] : field?.type === 'select' ? ['options'] : [])], 'field');
        text(field.name, 'field.name', 64);
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.name) || ['constructor', 'prototype', '__proto__'].includes(field.name) || names.has(field.name)) invalid('Field names must be unique safe identifiers.');
        names.add(field.name);
        text(field.label, 'field.label', 256);
        if (field.required !== undefined && typeof field.required !== 'boolean') invalid('field.required must be boolean.');
        if (field.type === 'text') {
            if (field.maxLength !== undefined) integer(field.maxLength, 'field.maxLength', 1, 4096);
            if (field.defaultValue !== undefined) text(field.defaultValue, 'field.defaultValue', field.maxLength ?? 4096, true);
        } else if (field.type === 'select') {
            choices(field.options, 'field.options', 64, 256);
            if (field.defaultValue !== undefined && !field.options.includes(field.defaultValue)) invalid('Select defaultValue must be one of its options.');
        } else if (field.type === 'confirm') {
            if (field.defaultValue !== undefined && typeof field.defaultValue !== 'boolean') invalid('Confirm defaultValue must be boolean.');
        } else invalid('Field type must be text, select, or confirm.');
        return field.type === 'select' ? { ...field, options: [...field.options] } : { ...field };
    });
    return { ...args, fields, timeoutMs: args.timeoutMs ?? 60000 };
}
export function validatePromptValues(fields: EditorPromptField[], values: unknown): Record<string, string | boolean> {
    object(values, fields.map(field => field.name), 'values');
    const result: Record<string, string | boolean> = {};
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(values, field.name)) invalid(`Missing value for ${field.name}.`);
        const value = values[field.name];
        if (field.type === 'confirm') {
            if (typeof value !== 'boolean' || (field.required && !value)) invalid(`${field.name} must be ${field.required ? 'confirmed' : 'boolean'}.`);
            result[field.name] = value;
        } else {
            text(value, field.name, field.type === 'text' ? field.maxLength ?? 4096 : 256, !field.required);
            if (field.type === 'select' && !field.options.includes(value) && (field.required || value !== '')) invalid(`${field.name} is not an allowed option.`);
            result[field.name] = value;
        }
    }
    return result;
}
