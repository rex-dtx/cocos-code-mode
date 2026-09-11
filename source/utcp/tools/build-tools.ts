import { JsonSchema } from '@utcp/sdk';
import { SuccessIndicatorSchema, ISuccessIndicator } from '../schemas';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { buildBuildPresetAudit, BuildPresetAuditResult } from '../../build-preset-audit';
// Slim view of a build task for agent consumption (full IBuildTaskItemJSON is huge)
interface IBuildTaskSummary {
    id: string;
    progress: number;
    state: string;
    message?: string;
    time?: string;
    stage?: string;
    dirty?: boolean;
    name?: string;
    platform?: string;
    buildPath?: string;
}

const BuildTaskSummarySchema: JsonSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        progress: { type: 'number' },
        state: { type: 'string' },
        message: { type: 'string' },
        time: { type: 'string' },
        stage: { type: 'string' },
        dirty: { type: 'boolean' },
        name: { type: 'string' },
        platform: { type: 'string' },
        buildPath: { type: 'string' }
    },
    required: ['id', 'progress', 'state']
};
const BUILD_TERMINAL_STATES = new Set(['success', 'succeeded', 'failed', 'error', 'cancelled', 'canceled', 'done', 'finished']);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function slimTask(task: any): IBuildTaskSummary {
    return {
        id: task.id,
        progress: task.progress,
        state: task.state,
        message: task.message,
        time: task.time,
        stage: task.stage,
        dirty: task.dirty,
        name: task.options?.name || task.options?.taskName,
        platform: task.options?.platform,
        buildPath: task.options?.buildPath
    };
}

export class BuildTools {
    @utcpTool('buildPresetAudit', 'Audit a bounded build preset against a public target profile without dispatching or mutating a build task.', {
        type: 'object',
        additionalProperties: false,
        properties: {
            platform: { type: 'string', minLength: 1, maxLength: 32 },
            options: { type: 'object', maxProperties: 64, additionalProperties: true },
        },
        required: ['platform', 'options'],
    }, {
        type: 'object',
        additionalProperties: false,
        properties: {
            platform: { type: 'string' },
            supportedOptions: { type: 'array', items: { type: 'string' } },
            unsupportedOptions: { type: 'array', items: { type: 'string' } },
            unknownOptions: { type: 'array', items: { type: 'string' } },
            errors: { type: 'array', items: { type: 'object' } },
            warnings: { type: 'array', items: { type: 'object' } },
            valid: { type: 'boolean' },
            complete: { type: 'boolean' },
        },
        required: ['platform', 'supportedOptions', 'unsupportedOptions', 'unknownOptions', 'errors', 'warnings', 'valid', 'complete'],
    }, 'POST', ['build', 'preset', 'audit', 'read-only'])
    async buildPresetAudit(args: { platform: string, options: Record<string, unknown> }): Promise<BuildPresetAuditResult> {
        return buildBuildPresetAudit(args.platform, args.options);
    }

    /** @deprecated Use buildManage({ operation: 'panel_open' }) — not registered, kept for delegation */
    async buildPanelOpen(args: { panel?: string }): Promise<ISuccessIndicator> {
        const panel = args.panel === 'build-bundle' ? 'build-bundle' : 'default';
        await Editor.Message.request('builder', 'open', panel);
        return { success: true };
    }

    /** @deprecated Use buildManage({ operation: 'tasks_info' }) — not registered, kept for delegation */
    async buildGetTasksInfo(args: { limit?: number } = {}): Promise<{ workerReady: boolean, free: boolean, tasks: IBuildTaskSummary[], total: number, truncated: boolean }> {
        const workerReady = await Editor.Message.request('builder', 'query-worker-ready');
        const info = await Editor.Message.request('builder', 'query-tasks-info');
        const queue = (info && info.queue) || {};
        const tasks = Object.values(queue).map((task: any) => slimTask(task));
        const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
        return { workerReady: !!workerReady, free: !!(info && info.free), tasks: tasks.slice(0, limit), total: tasks.length, truncated: tasks.length > limit };
    }

    /** @deprecated Use buildManage({ operation: 'get_task' }) — not registered, kept for delegation */
    async buildGetTask(args: { taskId: string }): Promise<{ task: IBuildTaskSummary, options?: any }> {
        if (!args.taskId) {
            throw new Error('buildGetTask requires taskId');
        }
        const item = await Editor.Message.request('builder', 'query-task', args.taskId);
        if (!item) {
            throw new Error(`Build task ${args.taskId} not found`);
        }
        return { task: slimTask(item), options: item.options || undefined };
    }

    /** @deprecated Use buildManage({ operation: 'trigger' }) — not registered, kept for delegation */
    async buildTrigger(args: { options: any }): Promise<{ success: boolean, taskId?: string }> {
        if (!args.options || typeof args.options !== 'object') {
            throw new Error('buildTrigger requires an options object (copy it from buildGetTask and modify)');
        }
        if (!args.options.platform) {
            throw new Error('options.platform is required (e.g. web-mobile)');
        }
        const result = await Editor.Message.request('builder', 'add-task', args.options);
        const taskId = typeof result === 'string' ? result : ((result && (result as any).id) || undefined);
        if (!taskId) throw new Error(`builder add-task returned no task id (got ${JSON.stringify(result ?? null)})`);
        return { success: true, taskId };
    }

    /** @deprecated Use buildManage({ operation: 'control' }) — not registered, kept for delegation */
    async buildTaskControl(args: { operation: string, taskId: string }): Promise<ISuccessIndicator> {
        if (!args.taskId) {
            throw new Error('buildTaskControl requires taskId');
        }
        const messageByOperation: Record<string, string> = {
            break: 'break-task',
            remove: 'remove-task',
            recompile: 'recompile-task'
        };
        const message = messageByOperation[args.operation];
        if (!message) {
            throw new Error(`Unknown build task operation: ${args.operation}`);
        }
        await Editor.Message.request('builder', message, args.taskId);
        return { success: true };
    }
    @utcpTool('buildTaskWait', 'Wait boundedly for one build task to reach a terminal state.', {
        type: 'object',
        properties: { taskId: { type: ['string', 'integer'] }, timeoutMs: { type: 'integer', minimum: 0, maximum: 120000, default: 30000 }, pollMs: { type: 'integer', minimum: 50, maximum: 5000, default: 500 } },
        required: ['taskId'],
    }, { type: 'object', properties: { completed: { type: 'boolean' }, timedOut: { type: 'boolean' }, task: { type: 'object' } }, required: ['completed', 'timedOut', 'task'] }, 'GET', ['build', 'task', 'wait', 'poll'])
    async buildTaskWait(args: { taskId: string | number, timeoutMs?: number, pollMs?: number }): Promise<{ completed: boolean, timedOut: boolean, task: IBuildTaskSummary }> {
        const taskId = String(args.taskId ?? '');
        if (!taskId) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'buildTaskWait requires taskId', recovery: 'Provide a Creator builder task id.' });
        const timeoutMs = Math.min(Math.max(args.timeoutMs ?? 30000, 0), 120000);
        const pollMs = Math.min(Math.max(args.pollMs ?? 500, 50), 5000);
        const deadline = Date.now() + timeoutMs;
        let item: any;
        do {
            item = await Editor.Message.request('builder', 'query-task', taskId);
            if (!item) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Build task ${taskId} not found`, recovery: 'Query build tasks and retry with an existing task id.' });
            const task = slimTask(item);
            if (BUILD_TERMINAL_STATES.has(String(task.state).toLowerCase())) return { completed: true, timedOut: false, task };
            if (Date.now() >= deadline) return { completed: false, timedOut: true, task };
            await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
        } while (true);
    }
    @utcpTool('buildLogInspect', 'Inspect bounded structured diagnostics exposed by one Creator build task.', {
        type: 'object',
        properties: { taskId: { type: ['string', 'integer'] }, maxEntries: { type: 'integer', minimum: 1, maximum: 256, default: 64 } },
        required: ['taskId'],
    }, { type: 'object', properties: { available: { type: 'boolean' }, task: { type: 'object' }, entries: { type: 'array' }, count: { type: 'integer' } }, required: ['available', 'task', 'entries', 'count'] }, 'GET', ['build', 'log', 'diagnostics', 'inspect'])
    async buildLogInspect(args: { taskId: string | number, maxEntries?: number }): Promise<{ available: boolean, task: IBuildTaskSummary, entries: Array<unknown>, count: number }> {
        const taskId = String(args.taskId ?? '');
        if (!taskId) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'buildLogInspect requires taskId', recovery: 'Provide a Creator builder task id.' });
        const item: any = await Editor.Message.request('builder', 'query-task', taskId);
        if (!item) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Build task ${taskId} not found`, recovery: 'Query build tasks and retry with an existing task id.' });
        const raw = item.logs ?? item.log ?? item.output ?? item.diagnostics;
        const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n/).filter(Boolean) : [];
        const bounded = entries.slice(0, Math.min(Math.max(args.maxEntries ?? 64, 1), 256));
        return { available: entries.length > 0, task: slimTask(item), entries: bounded, count: bounded.length };
    }
}
