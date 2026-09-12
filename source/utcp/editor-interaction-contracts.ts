import { JsonSchema } from '@utcp/sdk';

export interface EditorAskArgs {
    title: string;
    message: string;
    detail?: string;
    type?: 'info' | 'warning' | 'error' | 'question';
    buttons?: string[];
    cancelId?: number;
    timeoutMs?: number;
    presentation?: 'panel' | 'native';
    openPanel?: boolean;
}
export interface EditorAskResult {
    buttonIndex: number | null;
    buttonLabel: string | null;
    cancelled: boolean;
    timedOut: boolean;
}
interface PromptFieldBase { name: string; label: string; required?: boolean }
export type EditorPromptField =
    | (PromptFieldBase & { type: 'text'; defaultValue?: string; maxLength?: number })
    | (PromptFieldBase & { type: 'select'; options: string[]; defaultValue?: string })
    | (PromptFieldBase & { type: 'confirm'; defaultValue?: boolean });
export interface EditorPromptArgs {
    title: string;
    message: string;
    fields: EditorPromptField[];
    timeoutMs?: number;
    openPanel?: boolean;
}
export interface EditorPromptRequest extends EditorPromptArgs { kind: 'form'; requestId: string; expiresAt: number }
export interface EditorQuestionRequest extends EditorAskArgs { kind: 'question'; requestId: string; expiresAt: number; buttons: string[]; cancelId: number }
export type EditorInteractionRequest = EditorPromptRequest | EditorQuestionRequest;
export interface EditorPromptResult {
    requestId: string;
    submitted: boolean;
    cancelled: boolean;
    timedOut: boolean;
    values: Record<string, string | boolean>;
}

const title: JsonSchema = { type: 'string', minLength: 1, maxLength: 256 };
const message: JsonSchema = { type: 'string', minLength: 1, maxLength: 4096 };
const timeoutMs: JsonSchema = { type: 'integer', minimum: 1, maximum: 300000, description: 'Response deadline in milliseconds; default 60000, maximum 300000. Does not cancel a native dialog.' };
const openPanel: JsonSchema = { type: 'boolean', description: 'Default false: only notify an already open Agent Inbox, never open/focus it. True explicitly permits Creator.Panel.open, which may activate the panel.' };
export const EditorAskInputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        title, message, detail: { type: 'string', maxLength: 8192 },
        type: { type: 'string', enum: ['info', 'warning', 'error', 'question'] },
        buttons: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
        cancelId: { type: 'integer', minimum: 0, maximum: 7, description: 'Cancellation button index; defaults to the final button. Must be inside buttons.' },
        timeoutMs,
        presentation: { type: 'string', enum: ['panel', 'native'], description: 'Default panel: nonmodal Agent Inbox. Native is explicit opt-in and may block/focus Creator.' },
        openPanel,
    }, required: ['title', 'message'],
};
export const EditorAskOutputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        buttonIndex: { anyOf: [{ type: 'integer', minimum: 0, maximum: 7 }, { type: 'null' }] },
        buttonLabel: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        cancelled: { type: 'boolean' }, timedOut: { type: 'boolean' },
    }, required: ['buttonIndex', 'buttonLabel', 'cancelled', 'timedOut'],
};
const fieldProperties: Record<string, JsonSchema> = {
    name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$', description: 'Unique field key; constructor, prototype and __proto__ are forbidden.' },
    label: { type: 'string', minLength: 1, maxLength: 256 }, required: { type: 'boolean' },
};
export const EditorPromptInputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        title, message, timeoutMs, openPanel,
        fields: {
            type: 'array', minItems: 1, maxItems: 16,
            items: { oneOf: [
                { type: 'object', additionalProperties: false, properties: {
                    ...fieldProperties, type: { type: 'string', enum: ['text'] },
                    defaultValue: { type: 'string', maxLength: 4096 }, maxLength: { type: 'integer', minimum: 1, maximum: 4096 },
                }, required: ['name', 'label', 'type'] },
                { type: 'object', additionalProperties: false, properties: {
                    ...fieldProperties, type: { type: 'string', enum: ['select'] },
                    options: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 } },
                    defaultValue: { type: 'string', maxLength: 256 },
                }, required: ['name', 'label', 'type', 'options'] },
                { type: 'object', additionalProperties: false, properties: {
                    ...fieldProperties, type: { type: 'string', enum: ['confirm'] }, defaultValue: { type: 'boolean' },
                }, required: ['name', 'label', 'type'] },
            ] },
        },
    }, required: ['title', 'message', 'fields'],
};
export const EditorPromptOutputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        requestId: { type: 'string' }, submitted: { type: 'boolean' }, cancelled: { type: 'boolean' }, timedOut: { type: 'boolean' },
        values: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
    }, required: ['requestId', 'submitted', 'cancelled', 'timedOut', 'values'],
};
