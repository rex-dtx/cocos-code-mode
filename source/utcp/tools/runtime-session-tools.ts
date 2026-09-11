import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import {
    RuntimeSession,
    RuntimeSessionError,
    RuntimeSessionStore,
    RuntimeTargetKind,
} from '../utils/runtime-session-store';

type RuntimeState = { running: boolean, paused: boolean, timeScale: number, frameCount: number };

type LifecycleArgs = {
    operation: 'attach' | 'inspect' | 'stop' | 'reset' | 'list';
    targetKind?: RuntimeTargetKind;
    targetId?: string;
    sessionId?: string;
};

const store = new RuntimeSessionStore();
const RUNTIME_STATE_TIMEOUT_MS = 10_000;

async function withRuntimeStateTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Runtime state inspection timed out after ${RUNTIME_STATE_TIMEOUT_MS}ms`)), RUNTIME_STATE_TIMEOUT_MS);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export class RuntimeSessionTools {
    @utcpTool(
        'runtimeSessionLifecycle',
        'Attach, inspect, stop, reset and list finite runtime sessions with verified Creator preview readiness.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['attach', 'inspect', 'stop', 'reset', 'list'] },
                targetKind: { type: 'string', enum: ['game-view', 'browser-preview', 'simulator'] },
                targetId: { type: 'string', minLength: 1, maxLength: 256 },
                sessionId: { type: 'string', minLength: 1, maxLength: 64 },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                operation: { type: 'string' },
                session: { type: 'object' },
                sessions: { type: 'array' },
                state: { type: 'object' },
                ready: { type: 'boolean' },
            },
            required: ['success', 'operation'],
        },
        'POST',
        ['runtime', 'session', 'lifecycle', 'attach', 'inspect', 'stop', 'reset', 'list'],
    )
    async runtimeSessionLifecycle(args: LifecycleArgs): Promise<{
        success: boolean;
        operation: string;
        session?: RuntimeSession | { sessionId: string; reset: true };
        sessions?: RuntimeSession[];
        state?: RuntimeState;
        ready?: boolean;
    }> {
        try {
            switch (args.operation) {
                case 'attach':
                    return await this.attach(args);
                case 'inspect':
                    return await this.inspect(args);
                case 'stop':
                    return await this.stop(args);
                case 'reset':
                    return this.reset(args);
                case 'list':
                    return { success: true, operation: args.operation, sessions: store.list() };
                default:
                    throw new RuntimeSessionError('INVALID_ARGUMENT', `Unknown lifecycle operation: ${String(args.operation)}`);
            }
        } catch (error) {
            if (error instanceof RuntimeSessionError) {
                throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            }
            throw error;
        }
    }

    private async attach(args: LifecycleArgs): Promise<{
        success: boolean;
        operation: string;
        session: RuntimeSession;
        state: RuntimeState;
        ready: boolean;
    }> {
        if (!args.targetKind || !args.targetId) {
            throw new RuntimeSessionError('INVALID_ARGUMENT', 'attach requires targetKind and targetId');
        }
        if (args.targetKind !== 'game-view') {
            throw new ToolError({
                code: 'UNSUPPORTED_RUNTIME_TRANSPORT',
                status: 422,
                message: `Runtime target ${args.targetKind} has no verified transport on Creator 3.7.3.`,
                recovery: 'Use targetKind=game-view or qualify the target transport before attaching.',
            });
        }
        const session = store.attach(args.targetKind, args.targetId);
        try {
            const state = await this.readState();
            return { success: true, operation: 'attach', session, state, ready: true };
        } catch (error) {
            store.reset(session.sessionId);
            throw new ToolError({
                code: 'RUNTIME_NOT_READY',
                status: 409,
                message: 'Creator preview did not expose a valid runtime state after attach.',
                recovery: 'Start the game-view preview and retry attach.',
                details: { cause: error instanceof Error ? error.message : String(error) },
            });
        }
    }

    private async inspect(args: LifecycleArgs): Promise<{
        success: boolean;
        operation: string;
        session: RuntimeSession;
        state?: RuntimeState;
        ready: boolean;
    }> {
        const session = store.inspect(args.sessionId ?? '');
        if (session.status === 'stopped') return { success: true, operation: 'inspect', session, ready: false };
        if (session.targetKind !== 'game-view') throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: `Runtime target ${session.targetKind} has no verified transport.` });
        try {
            const state = await this.readState();
            return { success: true, operation: 'inspect', session, state, ready: true };
        } catch (error) {
            store.reset(session.sessionId);
            throw new ToolError({
                code: 'RUNTIME_NOT_READY',
                status: 409,
                message: 'Creator preview did not expose a valid runtime state during inspect.',
                recovery: 'Start the game-view preview and retry inspect.',
                details: { cause: error instanceof Error ? error.message : String(error) },
            });
        }
    }

    private stop(args: LifecycleArgs): never {
        store.reset(args.sessionId ?? '');
        throw new ToolError({
            code: 'RUNTIME_CONTROL_UNAVAILABLE',
            status: 409,
            message: 'Creator preview stop control is not verified for this runtime target; local session was released.',
            recovery: 'Use a Creator version with a verified preview lifecycle transport.',
        });
    }

    private reset(args: LifecycleArgs): never {
        store.reset(args.sessionId ?? '');
        throw new ToolError({
            code: 'RUNTIME_CONTROL_UNAVAILABLE',
            status: 409,
            message: 'Creator preview reset control is not verified for this runtime target; local session was released.',
            recovery: 'Use a Creator version with a verified preview lifecycle transport.',
        });
    }

    private async readState(): Promise<RuntimeState> {
        const result = await withRuntimeStateTimeout(Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'runtimeGetState', args: [] })) as any;
        if (!result || result.running !== true || typeof result.paused !== 'boolean' || typeof result.timeScale !== 'number' || typeof result.frameCount !== 'number') {
            throw new Error('Runtime preview is not running or returned malformed state');
        }
        return { running: true, paused: result.paused, timeScale: result.timeScale, frameCount: result.frameCount };
    }
}
