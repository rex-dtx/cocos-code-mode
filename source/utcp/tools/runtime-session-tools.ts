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
        let state: RuntimeState;
        try {
            state = await this.readState();
        } catch (error) {
            throw new ToolError({
                code: 'RUNTIME_NOT_READY',
                status: 409,
                message: 'Creator game-view preview readiness is not verified on this runtime.',
                recovery: 'Start a verified game-view preview transport before attaching a runtime session.',
                details: { cause: error instanceof Error ? error.message : String(error) },
            });
        }
        const session = store.attach(args.targetKind, args.targetId);
        return { success: true, operation: 'attach', session, state, ready: true };
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
        store.stop(args.sessionId ?? '');
        throw new ToolError({
            code: 'RUNTIME_CONTROL_UNAVAILABLE',
            status: 409,
            message: 'Creator preview stop control is not verified for this runtime target; local session was stopped.',
            recovery: 'Use runtimePreviewControl to stop the Creator preview, then reset this session.',
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
        const result: unknown = await withRuntimeStateTimeout(Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'runtimeGetState', args: [] }));
        if (!result || typeof result !== 'object'
            || !('paused' in result) || typeof result.paused !== 'boolean'
            || !('timeScale' in result) || typeof result.timeScale !== 'number'
            || !('frameCount' in result) || typeof result.frameCount !== 'number') {
            throw new Error('Runtime preview returned malformed state');
        }
        return { running: true, paused: result.paused, timeScale: result.timeScale, frameCount: result.frameCount };
    }
    @utcpTool(
        'runtimeStateObserve',
        'Observe verified state for an attached game-view runtime session.',
        {
            type: 'object',
            properties: { sessionId: { type: 'string', minLength: 1, maxLength: 64 } },
            required: ['sessionId'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                sessionId: { type: 'string' },
                state: {
                    type: 'object',
                    properties: {
                        running: { type: 'boolean' },
                        paused: { type: 'boolean' },
                        timeScale: { type: 'number' },
                        frameCount: { type: 'integer', minimum: 0 },
                    },
                    required: ['running', 'paused', 'timeScale', 'frameCount'],
                },
            },
            required: ['success', 'sessionId', 'state'],
        },
        'POST',
        ['runtime', 'state', 'observe', 'session'],
    )
    async runtimeStateObserve(args: { sessionId: string }): Promise<{ success: true, sessionId: string, state: RuntimeState }> {
        let session: RuntimeSession;
        try {
            session = store.inspect(args.sessionId);
        } catch (error) {
            if (error instanceof RuntimeSessionError) throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            throw error;
        }
        if (session.status === 'stopped') {
            throw new ToolError({
                code: 'RUNTIME_SESSION_STOPPED',
                status: 409,
                message: `Runtime session is stopped: ${session.sessionId}`,
                recovery: 'Attach a new game-view session before observing state.',
            });
        }
        if (session.targetKind !== 'game-view') {
            throw new ToolError({
                code: 'UNSUPPORTED_RUNTIME_TRANSPORT',
                status: 422,
                message: `Runtime target ${session.targetKind} has no verified transport.`,
            });
        }
        try {
            return { success: true, sessionId: session.sessionId, state: await this.readState() };
        } catch (error) {
            throw new ToolError({
                code: 'RUNTIME_NOT_READY',
                status: 409,
                message: 'Creator preview did not expose a valid runtime state.',
                recovery: 'Start the game-view preview and retry observation.',
                details: { cause: error instanceof Error ? error.message : String(error) },
            });
        }
    }

    @utcpTool(
        'runtimeWaitForState',
        'Wait boundedly for an attached game-view runtime state to match declared conditions.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                sessionId: { type: 'string', minLength: 1, maxLength: 64 },
                paused: { type: 'boolean' },
                minFrameCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
                timeoutMs: { type: 'integer', minimum: 100, maximum: 10000 },
            },
            required: ['sessionId'],
        },
        {
            type: 'object',
            properties: { success: { type: 'boolean' }, sessionId: { type: 'string' }, state: { type: 'object' }, elapsedMs: { type: 'integer', minimum: 0 } },
            required: ['success', 'sessionId', 'state', 'elapsedMs'],
        },
        'POST',
        ['runtime', 'state', 'wait', 'condition'],
    )
    async runtimeWaitForState(args: { sessionId: string, paused?: boolean, minFrameCount?: number, timeoutMs?: number }): Promise<{ success: true, sessionId: string, state: RuntimeState, elapsedMs: number }> {
        let session: RuntimeSession;
        try {
            session = store.inspect(args.sessionId);
        } catch (error) {
            if (error instanceof RuntimeSessionError) throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            throw error;
        }
        if (session.status === 'stopped') throw new ToolError({ code: 'RUNTIME_SESSION_STOPPED', status: 409, message: `Runtime session is stopped: ${session.sessionId}`, recovery: 'Attach a new game-view session before waiting for state.' });
        if (session.targetKind !== 'game-view') throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: `Runtime target ${session.targetKind} has no verified transport.` });
        if (args.paused === undefined && args.minFrameCount === undefined) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'runtimeWaitForState requires paused or minFrameCount.' });
        const timeoutMs = args.timeoutMs ?? 10000;
        const started = Date.now();
        let state = await this.readState();
        while ((args.paused !== undefined && state.paused !== args.paused) || (args.minFrameCount !== undefined && state.frameCount < args.minFrameCount)) {
            if (Date.now() - started >= timeoutMs) throw new ToolError({ code: 'RUNTIME_STATE_TIMEOUT', status: 409, message: 'Runtime state did not match the requested condition before timeout.', recovery: 'Start a verified game-view preview or increase timeoutMs within the bound.', details: { state, elapsedMs: Date.now() - started } });
            await new Promise((resolve) => setTimeout(resolve, 50));
            state = await this.readState();
        }
        return { success: true, sessionId: session.sessionId, state, elapsedMs: Date.now() - started };
    }
    @utcpTool(
        'previewSessionInspect',
        'Inspect one attached preview session and verify its current preview URL.',
        {
            type: 'object',
            additionalProperties: false,
            properties: { sessionId: { type: 'string', minLength: 1, maxLength: 64 } },
            required: ['sessionId'],
        },
        {
            type: 'object',
            properties: { success: { type: 'boolean' }, sessionId: { type: 'string' }, targetKind: { type: 'string' }, url: { type: 'string' }, ready: { type: 'boolean' }, stale: { type: 'boolean' } },
            required: ['success', 'sessionId', 'targetKind', 'url', 'ready', 'stale'],
        },
        'POST',
        ['preview', 'session', 'inspect', 'runtime'],
    )
    async previewSessionInspect(args: { sessionId: string }): Promise<{ success: true, sessionId: string, targetKind: string, url: string, ready: boolean, stale: boolean }> {
        let session: RuntimeSession;
        try {
            session = store.inspect(args.sessionId);
        } catch (error) {
            if (error instanceof RuntimeSessionError) throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            throw error;
        }
        if (session.status === 'stopped') return { success: true, sessionId: session.sessionId, targetKind: session.targetKind, url: '', ready: false, stale: true };
        let url: unknown;
        try {
            url = await Editor.Message.request('preview', 'query-preview-url');
        } catch (error) {
            throw new ToolError({ code: 'UNSUPPORTED_EDITOR_API', status: 422, message: 'Creator does not expose preview/query-preview-url.', details: { cause: error instanceof Error ? error.message : String(error) }, recovery: 'Use a Creator version with preview URL query support.' });
        }
        if (typeof url !== 'string' || url.length === 0) return { success: true, sessionId: session.sessionId, targetKind: session.targetKind, url: '', ready: false, stale: false };
        return { success: true, sessionId: session.sessionId, targetKind: session.targetKind, url, ready: true, stale: false };
    }
    @utcpTool(
        'runtimeScenarioRun',
        'Run a finite allow-listed runtime scenario using typed state steps only.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                sessionId: { type: 'string', minLength: 1, maxLength: 64 },
                steps: {
                    type: 'array', minItems: 1, maxItems: 16,
                    items: {
                        type: 'object', additionalProperties: false,
                        properties: {
                            operation: { type: 'string', enum: ['wait', 'assert'] },
                            paused: { type: 'boolean' },
                            minFrameCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
                            timeoutMs: { type: 'integer', minimum: 100, maximum: 10000 },
                        },
                        required: ['operation'],
                    },
                },
            },
            required: ['sessionId', 'steps'],
        },
        {
            type: 'object',
            properties: { success: { type: 'boolean' }, sessionId: { type: 'string' }, outcomes: { type: 'array' } },
            required: ['success', 'sessionId', 'outcomes'],
        },
        'POST',
        ['runtime', 'scenario', 'run', 'steps'],
    )
    async runtimeScenarioRun(args: { sessionId: string, steps: Array<{ operation: 'wait' | 'assert', paused?: boolean, minFrameCount?: number, timeoutMs?: number }> }): Promise<{ success: true, sessionId: string, outcomes: Array<Record<string, unknown>> }> {
        if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 16) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'runtimeScenarioRun requires 1-16 typed steps.' });
        const outcomes: Array<Record<string, unknown>> = [];
        for (let index = 0; index < args.steps.length; index++) {
            const step = args.steps[index];
            if (step.operation === 'wait') outcomes.push({ index, operation: step.operation, result: await this.runtimeWaitForState({ sessionId: args.sessionId, paused: step.paused, minFrameCount: step.minFrameCount, timeoutMs: step.timeoutMs }) });
            else if (step.operation === 'assert') outcomes.push({ index, operation: step.operation, result: await this.runtimeScenarioAssert({ sessionId: args.sessionId, paused: step.paused, minFrameCount: step.minFrameCount }) });
            else throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `Unsupported runtime scenario operation at step ${index}.` });
        }
        return { success: true, sessionId: args.sessionId, outcomes };
    }
    @utcpTool(
        'runtimeScenarioAssert',
        'Assert bounded runtime state for an attached game-view session.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                sessionId: { type: 'string', minLength: 1, maxLength: 64 },
                paused: { type: 'boolean' },
                minFrameCount: { type: 'integer', minimum: 0, maximum: 1000000000 },
            },
            required: ['sessionId'],
        },
        {
            type: 'object',
            properties: { success: { type: 'boolean' }, sessionId: { type: 'string' }, passed: { type: 'boolean' }, state: { type: 'object' }, issues: { type: 'array' } },
            required: ['success', 'sessionId', 'passed', 'state', 'issues'],
        },
        'POST',
        ['runtime', 'scenario', 'assert', 'state'],
    )
    async runtimeScenarioAssert(args: { sessionId: string, paused?: boolean, minFrameCount?: number }): Promise<{ success: true, sessionId: string, passed: boolean, state: RuntimeState, issues: string[] }> {
        let session: RuntimeSession;
        try {
            session = store.inspect(args.sessionId);
        } catch (error) {
            if (error instanceof RuntimeSessionError) throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            throw error;
        }
        if (session.status === 'stopped') throw new ToolError({ code: 'RUNTIME_SESSION_STOPPED', status: 409, message: `Runtime session is stopped: ${session.sessionId}`, recovery: 'Attach a new game-view session before asserting runtime state.' });
        if (session.targetKind !== 'game-view') throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: `Runtime target ${session.targetKind} has no verified transport.` });
        if (args.paused === undefined && args.minFrameCount === undefined) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'runtimeScenarioAssert requires paused or minFrameCount.' });
        const state = await this.readState();
        const issues: string[] = [];
        if (args.paused !== undefined && state.paused !== args.paused) issues.push(`paused expected ${args.paused} but was ${state.paused}`);
        if (args.minFrameCount !== undefined && state.frameCount < args.minFrameCount) issues.push(`frameCount expected at least ${args.minFrameCount} but was ${state.frameCount}`);
        return { success: true, sessionId: session.sessionId, passed: issues.length === 0, state, issues };
    }
}
