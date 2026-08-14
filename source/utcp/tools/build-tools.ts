import { JsonSchema } from '@utcp/sdk';
import { utcpTool } from '../decorators';
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

    @utcpTool(
        'buildPanelOpen',
        'Open the editor build panel (default build panel or the bundle build panel).',
        {
            type: 'object',
            properties: {
                panel: { type: 'string', enum: ['default', 'build-bundle'], description: 'Which build panel to open', default: 'default' }
            }
        },
        SuccessIndicatorSchema, "POST", ['build', 'panel', 'open', 'bundle']
    )
    async buildPanelOpen(args: { panel?: string }): Promise<ISuccessIndicator> {
        const panel = args.panel === 'build-bundle' ? 'build-bundle' : 'default';
        await Editor.Message.request('builder', 'open', panel);
        return { success: true };
    }

    @utcpTool(
        'buildGetTasksInfo',
        'Build pipeline status: worker ready, queue free, all tasks summary.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                workerReady: { type: 'boolean' },
                free: { type: 'boolean', description: 'True when no build task is running' },
                tasks: { type: 'array', items: BuildTaskSummarySchema }
            },
            required: ['workerReady', 'free', 'tasks']
        }, "GET", ['build', 'task', 'queue', 'status', 'progress', 'worker']
    )
    async buildGetTasksInfo(): Promise<{ workerReady: boolean, free: boolean, tasks: IBuildTaskSummary[] }> {
        const workerReady = await Editor.Message.request('builder', 'query-worker-ready');
        const info = await Editor.Message.request('builder', 'query-tasks-info');
        const queue = (info && info.queue) || {};
        const tasks = Object.values(queue).map((task: any) => slimTask(task));
        return { workerReady: !!workerReady, free: !!(info && info.free), tasks };
    }

    @utcpTool(
        'buildGetTask',
        'Get build task by id with full options. Copy+modify options for buildTrigger.',
        {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'Build task id (from buildGetTasksInfo)' }
            },
            required: ['taskId']
        },
        {
            type: 'object',
            properties: {
                task: BuildTaskSummarySchema,
                options: { type: 'object', description: 'Full IBuildTaskOption of the task' }
            },
            required: ['task']
        }, "GET", ['build', 'task', 'get', 'options', 'config']
    )
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

    @utcpTool(
        'buildTrigger',
        'Enqueue a build task. Copy options from buildGetTask and modify. Poll status with buildGetTasksInfo.',
        {
            type: 'object',
            properties: {
                options: {
                    type: 'object',
                    description: 'Full build options (IBuildTaskOption). Key fields: platform (e.g. web-mobile, web-desktop, android, windows), taskName, buildPath, startScene, scenes, debug, md5Cache.',
                    properties: {
                        platform: { type: 'string', description: 'Target platform, e.g. web-mobile, web-desktop, android, ios, windows' },
                        taskName: { type: 'string' },
                        buildPath: { type: 'string' }
                    }
                }
            },
            required: ['options']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, taskId: { type: 'string' } }, required: ['success'] }, "POST", ['build', 'trigger', 'start', 'export', 'task', 'platform']
    )
    async buildTrigger(args: { options: any }): Promise<{ success: boolean, taskId?: string }> {
        if (!args.options || typeof args.options !== 'object') {
            throw new Error('buildTrigger requires an options object (copy it from buildGetTask and modify)');
        }
        if (!args.options.platform) {
            throw new Error('options.platform is required (e.g. web-mobile)');
        }
        const result = await Editor.Message.request('builder', 'add-task', args.options);
        const taskId = typeof result === 'string' ? result : ((result && (result as any).id) || args.options.taskId || undefined);
        return { success: true, taskId };
    }

    @utcpTool(
        'buildTaskControl',
        'Manage build task: "break" aborts, "remove" deletes, "recompile" rebuilds scripts only. Get ids from buildGetTasksInfo.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['break', 'remove', 'recompile'] },
                taskId: { type: 'string', description: 'Build task id (from buildGetTasksInfo)' }
            },
            required: ['operation', 'taskId']
        },
        SuccessIndicatorSchema, "POST", ['build', 'task', 'break', 'abort', 'cancel', 'remove', 'delete', 'recompile', 'scripts']
    )
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
