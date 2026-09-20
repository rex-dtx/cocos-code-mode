import { utcpTool } from '../decorators';
import { RuntimePreviewResult, RuntimeSessionTools } from './runtime-session-tools';
import { RuntimeSessionError } from '../utils/runtime-session-store';
import { ToolError } from '../tool-error';

// Runtime control tools — pause/resume game loop, adjust time scale, query state.
// Delegates to scene.ts handlers via execute-scene-script for actual cc.* access.

export class RuntimeTools {

    @utcpTool(
        'runtimePause',
        'Pause the game runtime (stops update loop). Use for inspection or step-by-step debugging.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST',
        ['runtime', 'pause', 'game', 'debug', 'control']
    )
    async runtimePause(): Promise<{ success: boolean }> {
        await new RuntimeSessionTools().previewControl({ operation: 'pause' });
        return { success: true };
    }

    @utcpTool(
        'runtimeResume',
        'Resume the game runtime after pause.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST',
        ['runtime', 'resume', 'game', 'debug', 'control']
    )
    async runtimeResume(): Promise<{ success: boolean }> {
        await new RuntimeSessionTools().previewControl({ operation: 'resume' });
        return { success: true };
    }

    @utcpTool(
        'runtimeSetTimeScale',
        'Set the game time scale (0 = frozen, 1 = normal, >1 = fast-forward). Affects scheduler and tweens.',
        {
            type: 'object',
            properties: {
                scale: { type: 'number', minimum: 0, maximum: 10, description: 'Time scale multiplier (0-10)' },
            },
            required: ['scale'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, scale: { type: 'number' } }, required: ['success'] },
        'POST',
        ['runtime', 'time', 'scale', 'speed', 'slow', 'fast', 'game']
    )
    async runtimeSetTimeScale(args: { scale: number }): Promise<{ success: boolean, scale: number }> {
        if (!Number.isFinite(args.scale)) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'runtimeSetTimeScale requires a finite number.' });
        throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Creator execute-scene-script targets the edit renderer; game-view time-scale mutation is not qualified.' });
    }

    @utcpTool(
        'runtimeGetState',
        'Get current runtime state: paused, time scale, frame count.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                paused: { type: 'boolean' },
                timeScale: { type: ['number', 'null'] },
                frameCount: { type: ['number', 'null'] },
            },
            required: ['paused'],
        },
        'GET',
        ['runtime', 'state', 'game', 'status', 'debug']
    )
    async runtimeGetState(): Promise<{ paused: boolean, timeScale: number | null, frameCount: number | null }> {
        const result = await new RuntimeSessionTools().previewControl({ operation: 'state' });
        if (!result.state) throw new ToolError({ code: 'RUNTIME_NOT_READY', status: 409, message: 'Creator game-view is not running.' });
        return { paused: result.state.paused, timeScale: result.state.timeScale, frameCount: result.state.frameCount };
    }
    @utcpTool(
        'runtimePreviewControl',
        'Bounded Creator 3.7.3 game-view preview control. Lifecycle mutations are disabled because Creator preview is an experimental editor feature this bridge does not support; only operation=state remains available. Browser and simulator transports are unsupported.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['start', 'pause', 'resume', 'stop', 'step', 'state'] },
                sessionId: { type: 'string', minLength: 1, maxLength: 64 },
                targetId: { type: 'string', minLength: 1, maxLength: 256, description: 'Optional expected scene UUID.' },
                timeoutMs: { type: 'integer', minimum: 100, maximum: 60000 },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                operation: { type: 'string' },
                session: { type: 'object' },
                preview: { type: 'object' },
                ready: { type: 'boolean' },
                state: {
                    type: 'object',
                    properties: {
                        paused: { type: 'boolean' },
                        running: { type: 'boolean' },
                        sceneUuid: { type: 'string' },
                        timeScale: { type: ['number', 'null'] },
                        frameCount: { type: ['number', 'null'] },
                    },
                },
            },
            required: ['success', 'operation'],
        },
        'POST',
        ['runtime', 'session', 'preview', 'start', 'stop', 'pause', 'resume', 'step', 'state']
    )
    async runtimeSessionManage(args: { operation: 'start' | 'pause' | 'resume' | 'stop' | 'step' | 'state', sessionId?: string, targetId?: string, timeoutMs?: number }): Promise<RuntimePreviewResult> {
        try {
            return await new RuntimeSessionTools().previewControl(args);
        } catch (error) {
            if (error instanceof RuntimeSessionError) throw new ToolError({ code: error.code, status: error.code === 'SESSION_NOT_FOUND' ? 404 : 400, message: error.message });
            throw error;
        }
    }
}
