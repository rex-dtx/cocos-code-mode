import { randomBytes } from 'crypto';
import packageJSON from '../../package.json';
import { EditorControlSnapshot, EditorNotification, EditorNotifyArgs, EditorProgressArgs, EditorTask, EditorTaskCancelResult, EditorTaskListArgs, EditorTaskListResult } from './editor-control-contracts';
import { controlEnum, controlNumber, controlObject, controlTaskId, controlText } from './editor-control-validation';
import { ToolError } from './tool-error';

const RETENTION_MS = 300000;
const MAX_TASKS = 100;
const MAX_NOTIFICATIONS = 50;
const tasks = new Map<string, { task: EditorTask; timeoutMs: number }>();
const notifications: EditorNotification[] = [];
let timer: NodeJS.Timeout | undefined;

function broadcast(): void {
    // Sending to a panel can implicitly open it. Broadcast has no activation side effects.
    try { Editor.Message.broadcast(`${packageJSON.name}:editor-control-changed`); }
    catch (error) { console.warn('[cc-bridge-3x] Control state broadcast failed:', error); }
}
function schedule(): void {
    clearTimeout(timer);
    timer = undefined;
    let next = Infinity;
    for (const { task } of tasks.values()) next = Math.min(next, task.finishedAt === null ? task.expiresAt : task.finishedAt + RETENTION_MS);
    if (notifications.length) next = Math.min(next, notifications[0].createdAt + RETENTION_MS);
    if (next !== Infinity) {
        timer = setTimeout(() => { sweep(); schedule(); }, Math.max(1, next - Date.now()));
        timer.unref?.();
    }
}
function sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, { task }] of tasks) {
        if (task.status === 'running' && task.expiresAt <= now) {
            task.status = 'timedOut';
            task.finishedAt = task.expiresAt;
            task.updatedAt = task.expiresAt;
            changed = true;
        }
        if (task.finishedAt !== null && task.finishedAt + RETENTION_MS <= now) { tasks.delete(id); changed = true; }
    }
    while (notifications.length && notifications[0].createdAt + RETENTION_MS <= now) { notifications.shift(); changed = true; }
    if (changed) broadcast();
}
function changed(): void { schedule(); broadcast(); }
function lookup(taskId: string): { task: EditorTask; timeoutMs: number } {
    sweep();
    const entry = tasks.get(taskId);
    if (!entry) throw new ToolError({ code: 'EDITOR_TASK_NOT_FOUND', status: 404, message: 'Task is unknown or its retention window expired.' });
    return entry;
}
export function notifyEditor(input: EditorNotifyArgs): EditorNotification {
    const args = controlObject(input, ['title', 'message', 'level']);
    const title = controlText(args.title, 'title', 256, true);
    const message = controlText(args.message, 'message', 4096, true);
    const level = args.level === undefined ? 'info' : controlEnum(args.level, 'level', ['info', 'warning', 'error'] as const);
    sweep();
    const notification: EditorNotification = { id: randomBytes(16).toString('hex'), title, message, level, createdAt: Date.now() };
    if (notifications.length === MAX_NOTIFICATIONS) notifications.shift();
    notifications.push(notification);
    console[level === 'warning' ? 'warn' : level](`[cc-bridge-3x] ${title}: ${message}`);
    changed();
    return { ...notification };
}
export function progressEditor(input: EditorProgressArgs): EditorTask {
    const args = controlObject(input, ['operation', 'title', 'message', 'progress', 'timeoutMs', 'taskId', 'status']);
    const operation = controlEnum(args.operation, 'operation', ['start', 'update', 'finish'] as const);
    controlObject(args, operation === 'start' ? ['operation', 'title', 'message', 'progress', 'timeoutMs'] : operation === 'update' ? ['operation', 'taskId', 'message', 'progress'] : ['operation', 'taskId', 'message', 'status']);
    const message = args.message === undefined ? undefined : controlText(args.message, 'message', 4096);
    const progress = args.progress === undefined ? undefined : controlNumber(args.progress, 'progress', 0, 100, false);
    if (operation === 'start') {
        const title = controlText(args.title, 'title', 256, true);
        const timeoutMs = args.timeoutMs === undefined ? 60000 : controlNumber(args.timeoutMs, 'timeoutMs', 1, 300000);
        sweep();
        if (tasks.size === MAX_TASKS) {
            const evict = Array.from(tasks.values()).filter(entry => entry.task.finishedAt !== null).sort((a, b) => a.task.finishedAt! - b.task.finishedAt!)[0];
            if (!evict) throw new ToolError({ code: 'EDITOR_TASK_CAPACITY', status: 409, message: '100 tasks are active. Finish a task or wait for its inactivity deadline.' });
            tasks.delete(evict.task.taskId);
        }
        const now = Date.now();
        const task: EditorTask = { taskId: randomBytes(16).toString('hex'), title, message: message ?? '', progress: progress ?? null, status: 'running', cancelRequested: false,
            createdAt: now, updatedAt: now, expiresAt: now + timeoutMs, finishedAt: null };
        tasks.set(task.taskId, { task, timeoutMs });
        changed();
        return { ...task };
    }
    const taskId = controlTaskId(args.taskId);
    const status = operation === 'finish' ? controlEnum(args.status, 'status', ['completed', 'failed', 'cancelled'] as const) : undefined;
    const { task, timeoutMs } = lookup(taskId);
    if (task.status !== 'running') throw new ToolError({ code: 'EDITOR_TASK_TERMINAL', status: 409, message: 'Terminal tasks cannot be updated or finished again.' });
    const now = Date.now();
    if (message !== undefined) task.message = message;
    task.updatedAt = now;
    if (status !== undefined) {
        task.status = status;
        task.finishedAt = now;
        if (status === 'completed') task.progress = 100;
    } else {
        if (progress !== undefined) task.progress = progress;
        task.expiresAt = now + timeoutMs;
    }
    changed();
    return { ...task };
}
export function listEditorTasks(input: EditorTaskListArgs = {}): EditorTaskListResult {
    const args = controlObject(input, ['status', 'taskId', 'limit']);
    const status = args.status === undefined ? undefined : controlEnum(args.status, 'status', ['running', 'completed', 'failed', 'cancelled', 'timedOut'] as const);
    const taskId = args.taskId === undefined ? undefined : controlTaskId(args.taskId);
    const limit = args.limit === undefined ? 50 : controlNumber(args.limit, 'limit', 1, MAX_TASKS);
    sweep();
    const matching = Array.from(tasks.values(), entry => entry.task).reverse().filter(task => (!status || task.status === status) && (!taskId || task.taskId === taskId));
    return { tasks: matching.slice(0, limit).map(task => ({ ...task })), total: matching.length, truncated: matching.length > limit };
}
export function cancelEditorTask(input: { taskId: string }): EditorTaskCancelResult {
    const args = controlObject(input, ['taskId']);
    const { task } = lookup(controlTaskId(args.taskId));
    const requested = task.status === 'running';
    if (requested && !task.cancelRequested) {
        task.cancelRequested = true;
        task.updatedAt = Date.now();
        // Cancellation is a flag only, and does not renew the worker's deadline.
        changed();
    }
    return { task: { ...task }, requested, interrupted: false };
}
export function getEditorControl(): EditorControlSnapshot {
    const listed = listEditorTasks({ limit: MAX_TASKS });
    return { notifications: notifications.map(notification => ({ ...notification })).reverse(), tasks: listed.tasks };
}
export function disposeEditorControl(): void {
    clearTimeout(timer);
    timer = undefined;
    tasks.clear();
    notifications.length = 0;
    broadcast();
}
