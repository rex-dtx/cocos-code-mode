import { JsonSchema } from '@utcp/sdk';

export type EditorTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timedOut';
export interface EditorNotification {
    id: string; level: 'info' | 'warning' | 'error'; title: string; message: string; createdAt: number;
}
export interface EditorTask {
    taskId: string; title: string; message: string; progress: number | null; status: EditorTaskStatus;
    cancelRequested: boolean; createdAt: number; updatedAt: number; expiresAt: number; finishedAt: number | null;
}
export type EditorNotifyArgs = Pick<EditorNotification, 'title' | 'message'> & { level?: EditorNotification['level'] };
export type EditorProgressArgs =
    | { operation: 'start'; title: string; message?: string; progress?: number; timeoutMs?: number }
    | { operation: 'update'; taskId: string; message?: string; progress?: number }
    | { operation: 'finish'; taskId: string; status: 'completed' | 'failed' | 'cancelled'; message?: string };
export interface EditorTaskListArgs { status?: EditorTaskStatus; taskId?: string; limit?: number }
export interface EditorTaskListResult { tasks: EditorTask[]; total: number; truncated: boolean }
export interface EditorTaskCancelResult { task: EditorTask; requested: boolean; interrupted: false }
export interface EditorControlSnapshot { notifications: EditorNotification[]; tasks: EditorTask[] }
export interface EditorStateArgs { timeoutMs?: number }
export interface EditorStateResult {
    capturedAt: number; projectPath: string | null; engineVersion: string | null;
    scene: { ready: boolean | null; dirty: boolean | null; current: { uuid: string | null; url: string | null; name: string | null } | null };
    busy: { scene: boolean | null; assetImport: boolean | null; build: boolean | null; tasks: boolean; inbox: boolean };
    tasks: { running: number; cancellationRequested: number; retained: number };
    inbox: { pending: boolean; requestId: string | null; kind: 'form' | 'question' | null; expiresAt: number | null };
    unavailable: string[];
}

const text = (maxLength: number, minLength = 0): JsonSchema => ({ type: 'string', minLength, maxLength });
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({ type: 'object', additionalProperties: false, properties, required });
const timestamp: JsonSchema = { type: 'integer', minimum: 0 };
const boolean: JsonSchema = { type: 'boolean' };
const title = text(256, 1);
const message = text(4096);
const taskId: JsonSchema = { type: 'string', pattern: '^[a-f0-9]{32}$' };
const progress: JsonSchema = { type: 'number', minimum: 0, maximum: 100 };
const status: JsonSchema = { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled', 'timedOut'] };
const terminal: JsonSchema = { type: 'string', enum: ['completed', 'failed', 'cancelled'] };
const timeoutMs: JsonSchema = { type: 'integer', minimum: 1, maximum: 300000, description: 'Inactivity deadline; default 60000ms. Each update renews it. Expiry marks timedOut, never interrupts work.' };
export const EditorTaskSchema = object({ taskId, title, message, progress: nullable(progress), status, cancelRequested: boolean,
    createdAt: timestamp, updatedAt: timestamp, expiresAt: timestamp, finishedAt: nullable(timestamp) });
export const EditorNotifyInputSchema = object({ title, message: text(4096, 1), level: { type: 'string', enum: ['info', 'warning', 'error'] } }, ['title', 'message']);
export const EditorNotifyOutputSchema = object({ id: taskId, title, message: text(4096, 1), level: { type: 'string', enum: ['info', 'warning', 'error'] }, createdAt: timestamp });
export const EditorProgressInputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: { operation: { type: 'string', enum: ['start', 'update', 'finish'] }, title, message, taskId, progress, timeoutMs, status: terminal },
    required: ['operation'],
    oneOf: [
        object({ operation: { const: 'start' }, title, message, progress, timeoutMs }, ['operation', 'title']),
        object({ operation: { const: 'update' }, taskId, message, progress }, ['operation', 'taskId']),
        object({ operation: { const: 'finish' }, taskId, message, status: terminal }, ['operation', 'taskId', 'status']),
    ],
};
export const EditorTaskListInputSchema = object({ status, taskId, limit: { type: 'integer', minimum: 1, maximum: 100 } }, []);
export const EditorTaskListOutputSchema = object({ tasks: { type: 'array', maxItems: 100, items: EditorTaskSchema }, total: { type: 'integer', minimum: 0, maximum: 100 }, truncated: boolean });
export const EditorTaskCancelInputSchema = object({ taskId });
export const EditorTaskCancelOutputSchema = object({ task: EditorTaskSchema, requested: boolean, interrupted: { type: 'boolean', const: false } });
export const EditorStateInputSchema = object({ timeoutMs: { type: 'integer', minimum: 1, maximum: 5000, description: 'Read deadline, default 1000ms. Unavailable APIs yield null and an unavailable entry.' } }, []);
export const EditorStateOutputSchema = object({
    capturedAt: timestamp, projectPath: nullable(text(4096)),
    scene: object({ ready: nullable(boolean), dirty: nullable(boolean), current: nullable(object({ uuid: nullable(text(256)), url: nullable(text(4096)), name: nullable(text(256)) })) }),
    busy: object({ scene: nullable(boolean), tasks: boolean, inbox: boolean }),
    tasks: object({ running: { type: 'integer', minimum: 0, maximum: 100 }, cancellationRequested: { type: 'integer', minimum: 0, maximum: 100 }, retained: { type: 'integer', minimum: 0, maximum: 100 } }),
    inbox: object({ pending: boolean, requestId: nullable(taskId), kind: nullable({ type: 'string', enum: ['form', 'question'] }), expiresAt: nullable(timestamp) }),
    unavailable: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['projectPath', 'scene.ready', 'scene.dirty', 'scene.current'] } },
});
