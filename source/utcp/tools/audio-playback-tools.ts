import { JsonSchema } from '@utcp/sdk';
import { AudioPlaybackOperation, AudioPlaybackSuccess } from '../../audio-playback';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { RuntimeSessionTools } from './runtime-session-tools';

export interface AudioPlaybackObserveArgs { sessionId: string; nodeReference: { id: string } }
export interface AudioPlaybackControlArgs extends AudioPlaybackObserveArgs {
    operation: Exclude<AudioPlaybackOperation, 'observe'>;
    time?: number;
    timeoutMs?: number;
}
const targetProperties: Record<string, JsonSchema> = {
    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
    nodeReference: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['id'] },
};
const stateSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        currentTime: { type: 'number', minimum: 0 }, duration: { type: 'number', minimum: 0 }, playing: { type: 'boolean' },
        playbackState: { type: 'string', enum: ['init', 'playing', 'paused', 'stopped', 'interrupted'] }, loaded: { type: 'boolean' },
        userActivation: { type: 'string', enum: ['active', 'inactive', 'unknown'] }, activationRequirement: { type: 'string', enum: ['unknown'] },
    }, required: ['currentTime', 'duration', 'playing', 'playbackState', 'loaded', 'userActivation', 'activationRequirement'],
};
const outputSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        success: { type: 'boolean', enum: [true] }, sessionId: { type: 'string' }, targetId: { type: 'string' }, nodeUuid: { type: 'string' },
        operation: { type: 'string', enum: ['play', 'pause', 'stop', 'seek', 'observe'] }, state: stateSchema,
        started: { type: 'boolean' }, ended: { type: 'boolean' },
    }, required: ['success', 'sessionId', 'targetId', 'nodeUuid', 'operation', 'state', 'started', 'ended'],
};
function validate(args: AudioPlaybackObserveArgs, operation: AudioPlaybackOperation, time?: number, timeoutMs?: number): void {
    const invalid = (message: string): never => { throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message }); };
    if (!args || typeof args.sessionId !== 'string' || !args.sessionId.trim() || args.sessionId.length > 64) invalid('sessionId is required (1..64 characters).');
    if (!args.nodeReference || typeof args.nodeReference.id !== 'string' || !args.nodeReference.id.trim() || args.nodeReference.id.length > 256) invalid('nodeReference.id is required (1..256 characters).');
    if (!['play', 'pause', 'stop', 'seek', 'observe'].includes(operation)) invalid('Unknown audio operation.');
    if (operation === 'seek' ? !Number.isFinite(time) || time! < 0 : time !== undefined) invalid('Only seek accepts time, a finite nonnegative number of seconds.');
    if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)) invalid('timeoutMs must be an integer from 100 to 5000.');
}

export class AudioPlaybackTools {
    @utcpTool('audioPlaybackControl', 'Reserved finite audio playback contract. Creator 3.7.3 does not expose a qualified extension route into the active Game View renderer, so this fails closed until that transport exists.', {
        type: 'object', additionalProperties: false,
        properties: { ...targetProperties, operation: { type: 'string', enum: ['play', 'pause', 'stop', 'seek'] },
            time: { type: 'number', minimum: 0 }, timeoutMs: { type: 'integer', minimum: 100, maximum: 5000 } },
        required: ['sessionId', 'nodeReference', 'operation'],
    }, outputSchema, 'POST', ['audio', 'playback', 'runtime', 'control'])
    async audioPlaybackControl(args: AudioPlaybackControlArgs): Promise<AudioPlaybackSuccess> {
        if (!args || !['play', 'pause', 'stop', 'seek'].includes(args.operation)) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'Control requires play, pause, stop, or seek.' });
        return this.execute(args, args.operation, args.time, args.timeoutMs);
    }

    @utcpTool('audioPlaybackObserve', 'Reserved finite audio observation contract. Creator 3.7.3 routes extension scene scripts to the edit renderer, so runtime observation fails closed rather than reading the wrong scene.', {
        type: 'object', additionalProperties: false, properties: targetProperties, required: ['sessionId', 'nodeReference'],
    }, outputSchema, 'POST', ['audio', 'playback', 'runtime', 'observe'])
    async audioPlaybackObserve(args: AudioPlaybackObserveArgs): Promise<AudioPlaybackSuccess> {
        return this.execute(args, 'observe');
    }

    private async execute(args: AudioPlaybackObserveArgs, operation: AudioPlaybackOperation, time?: number, timeoutMs?: number): Promise<AudioPlaybackSuccess> {
        validate(args, operation, time, timeoutMs);
        try {
            const inspected = await new RuntimeSessionTools().runtimeSessionLifecycle({ operation: 'inspect', sessionId: args.sessionId });
            const session = inspected.session;
            if (session && 'status' in session && session.status === 'stopped') throw new ToolError({ code: 'RUNTIME_SESSION_STOPPED', status: 409, message: 'The runtime session is stopped.' });
            if (!inspected.success || !inspected.ready || !session || !('targetId' in session) || session.sessionId !== args.sessionId) throw new ToolError({ code: 'RUNTIME_NOT_READY', status: 409, message: 'The attached runtime session is not ready.' });
            if (session.targetKind !== 'game-view') throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Audio supports the Creator scene-preview transport only.' });
            throw new ToolError({
                code: 'UNSUPPORTED_RUNTIME_TRANSPORT',
                status: 422,
                message: 'Creator 3.7.3 routes extension execute-scene-script calls to the edit renderer, not the active Game View renderer.',
                recovery: 'Use audioSourceConfigure for authoring. Runtime audio control requires a separately qualified finite Game View transport.',
            });
        } catch (error) {
            if (error instanceof ToolError) throw error;
            throw new ToolError({ code: 'AUDIO_TRANSPORT_UNAVAILABLE', status: 502,
                message: 'Audio session or scene transport failed.', details: { cause: error instanceof Error ? error.message : String(error) } });
        }
    }
}
