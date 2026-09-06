import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';
import { ToolError } from '../tool-error';

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
        const result = await sceneScript<any>('runtime-pause');
        return { success: result === true };
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
        const result = await sceneScript<any>('runtime-resume');
        return { success: result === true };
    }

    @utcpTool(
        'runtimeSetTimeScale',
        'Set the game time scale (0 = frozen, 1 = normal, >1 = fast-forward). Affects scheduler and tweens.',
        {
            type: 'object',
            properties: {
                scale: { type: 'number', description: 'Time scale multiplier (0-10)' },
            },
            required: ['scale'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, scale: { type: 'number' } }, required: ['success'] },
        'POST',
        ['runtime', 'time', 'scale', 'speed', 'slow', 'fast', 'game']
    )
    async runtimeSetTimeScale(args: { scale: number }): Promise<{ success: boolean, scale: number }> {
        const raw = typeof args.scale === 'string' ? Number(args.scale) : args.scale;
        if (!Number.isFinite(raw)) {
            throw new ToolError({
                code: 'INVALID_INPUT',
                status: 400,
                message: 'runtimeSetTimeScale requires a finite number',
                recovery: 'Pass scale between 0 and 10.',
            });
        }
        const scale = Math.max(0, Math.min(raw, 10));
        const result = await sceneScript<any>('runtime-set-timescale', scale);
        return { success: result === true, scale };
    }

    @utcpTool(
        'runtimeGetState',
        'Get current runtime state: paused, time scale, frame count.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                paused: { type: 'boolean' },
                timeScale: { type: 'number' },
                frameCount: { type: 'number' },
            },
            required: ['paused'],
        },
        'GET',
        ['runtime', 'state', 'game', 'status', 'debug']
    )
    async runtimeGetState(): Promise<{ paused: boolean, timeScale: number, frameCount: number }> {
        const result = await sceneScript<any>('runtime-get-state');
        if (!result || typeof result !== 'object') {
            throw new ToolError({
                code: 'RUNTIME_UNAVAILABLE',
                status: 422,
                message: 'runtimeGetState: no runtime state — is a scene open?',
                recovery: 'Open a scene, then retry. Preview play is not required for editor scene director.',
            });
        }
        if (typeof result.paused !== 'boolean' || typeof result.timeScale !== 'number' || typeof result.frameCount !== 'number') {
            throw new ToolError({
                code: 'MALFORMED_RUNTIME_STATE',
                status: 500,
                message: `runtimeGetState: malformed payload ${JSON.stringify(result).slice(0, 160)}`,
                recovery: 'Rebuild the extension so scene-script runtime-get-state is loaded.',
            });
        }
        return { paused: result.paused, timeScale: result.timeScale, frameCount: result.frameCount };
    }
}
