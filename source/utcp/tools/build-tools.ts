import { JsonSchema } from '@utcp/sdk';
import { SuccessIndicatorSchema, ISuccessIndicator } from '../schemas';

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
}
