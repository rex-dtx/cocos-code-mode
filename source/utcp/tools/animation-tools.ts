import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator } from '../schemas';
import { ToolError } from '../tool-error';

// Animation editing lives in the `scene` module (not only the animator panel).
// Messages are runtime-only (absent from typed message.d.ts); signatures mirror
// AnimationSceneFacade in @types/cce/3d/facade/animation-scene-facade.d.ts.

function requireRef(ref: IInstanceReference | undefined, what: string): string {
    if (!ref || typeof ref !== 'object' || typeof ref.id !== 'string' || ref.id.trim().length === 0 || ref.id.length > 256) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${what} must be a non-empty reference id of at most 256 characters.` });
    }
    return ref.id;
}

const MAX_CLIPS = 200;
const AnimationClipSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        uuid: { type: 'string', maxLength: 256 },
        id: { type: 'string', maxLength: 256 },
        name: { type: 'string', maxLength: 256 },
        duration: { type: 'number' }
    }
};

// Clip-info is already a bounded summary route in Creator; retain only records
// and cap the returned list at the caller-selected limit.
type AnimationClipRecord = Record<string, unknown>;

function validateClipLimit(value: unknown): number {
    if (value === undefined) return 50;
    if (!Number.isInteger(value) || !Number.isFinite(value) || Number(value) < 1 || Number(value) > MAX_CLIPS) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `maxClips must be an integer from 1 to ${MAX_CLIPS}.` });
    }
    return Number(value);
}

function clipList(info: unknown): AnimationClipRecord[] {
    if (Array.isArray(info)) {
        return info.filter((clip): clip is AnimationClipRecord => !!clip && typeof clip === 'object' && !Array.isArray(clip));
    }
    if (info && typeof info === 'object' && 'clips' in info && Array.isArray(info.clips)) {
        return info.clips.filter((clip): clip is AnimationClipRecord => !!clip && typeof clip === 'object' && !Array.isArray(clip));
    }
    return [];
}


function slimClipDump(dump: any): any {
    if (!dump || typeof dump !== 'object') {
        return dump;
    }
    const curves = Array.isArray(dump.curves) ? dump.curves : [];
    return {
        name: dump.name,
        duration: dump.duration,
        sample: dump.sample,
        speed: dump.speed,
        wrapMode: dump.wrapMode,
        time: dump.time,
        isLock: dump.isLock,
        isSkeleton: dump.isSkeleton,
        useBakedAnimation: dump.useBakedAnimation,
        events: Array.isArray(dump.events) ? dump.events.slice(0, 200) : [],
        curveCount: curves.length,
        tracks: curves.slice(0, 200).map((c: any) => ({
            nodePath: c?.nodePath,
            key: c?.key,
            displayName: c?.displayName,
            keyframeCount: Array.isArray(c?.keyframes) ? c.keyframes.length : 0
        })),
        truncated: curves.length > 200
    };
}

export class AnimationTools {
    @utcpTool(
        'skeletalAnimationInspect',
        'Inspect animation clips exposed by a scene animation root.',
        {
            type: 'object',
            properties: { nodeReference: InstanceReferenceSchema, maxClips: { type: 'number', minimum: 1, maximum: 200, default: 50 } },
            required: ['nodeReference']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema, clips: { type: 'array' }, totalClips: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['reference', 'clips', 'totalClips', 'truncated'] },
        'GET', ['skeletal', 'animation', 'inspect', 'clips']
    )
    async skeletalAnimationInspect(args: { nodeReference?: IInstanceReference, maxClips?: number }): Promise<{ reference: IInstanceReference, clips: AnimationClipRecord[], totalClips: number, truncated: boolean }> {
        const nodeId = requireRef(args?.nodeReference, 'nodeReference');
        const maxClips = args?.maxClips === undefined ? 50 : args.maxClips;
        if (!Number.isInteger(maxClips) || maxClips < 1 || maxClips > 200) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'maxClips must be an integer from 1 to 200.' });
        }
        const info = await Editor.Message.request('scene', 'query-animation-clips-info', nodeId);
        const clips: AnimationClipRecord[] = Array.isArray(info)
            ? info.filter((clip): clip is AnimationClipRecord => !!clip && typeof clip === 'object' && !Array.isArray(clip))
            : info && typeof info === 'object' && 'clips' in info && Array.isArray(info.clips)
                ? info.clips.filter((clip: unknown): clip is AnimationClipRecord => !!clip && typeof clip === 'object' && !Array.isArray(clip))
                : [];
        return { reference: { id: nodeId, type: args.nodeReference?.type ?? 'cc.Node' }, clips: clips.slice(0, maxClips), totalClips: clips.length, truncated: clips.length > maxClips };
    }

    @utcpTool(
        'skeletalAnimationValidate',
        'Validate that a scene animation root exposes a well-formed clip list.',
        {
            type: 'object',
            properties: { nodeReference: InstanceReferenceSchema, maxClips: { type: 'number', minimum: 1, maximum: 200, default: 50 } },
            required: ['nodeReference']
        },
        { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, clipCount: { type: 'number' } }, required: ['valid', 'issues', 'clipCount'] },
        'POST', ['skeletal', 'animation', 'validate', 'clips']
    )
    async skeletalAnimationValidate(args: { nodeReference?: IInstanceReference, maxClips?: number }): Promise<{ valid: boolean, issues: string[], clipCount: number }> {
        const inspected = await this.skeletalAnimationInspect(args);
        const issues: string[] = [];
        inspected.clips.forEach((clip, index) => {
            if (!clip || typeof clip !== 'object') issues.push(`clip[${index}] is not an object`);
            else if (typeof clip.uuid !== 'string' && typeof clip.id !== 'string' && typeof clip.name !== 'string') issues.push(`clip[${index}] has no stable identity`);
        });
        return { valid: issues.length === 0, issues, clipCount: inspected.totalClips };
    }

    @utcpTool(
        'animationQuery',
        'Query animation data: root_info, clips_info, clip_dump (slim by default), properties, state, value_at_frame.',
        {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['root_info', 'root', 'edit_info', 'clips_info', 'clip_dump', 'properties', 'state', 'current_info', 'clip_time', 'value_at_frame']
                },
                nodeReference: InstanceReferenceSchema,
                clipReference: InstanceReferenceSchema,
                includeCurves: { type: 'boolean', description: 'For clip_dump: return the full curve/keyframe data instead of a track summary. Can be very large.', default: false },
                maxCurves: { type: 'number', minimum: 1, maximum: 1000, default: 200, description: 'For clip_dump with includeCurves: maximum raw curves to return.' },
                nodePath: { type: 'string', description: 'For value_at_frame: path of the animated node relative to the animation root, e.g. "/Body/Arm"' },
                propKey: { type: 'string', description: 'For value_at_frame: animated property key, e.g. "position"' },
                frame: { type: 'number', description: 'For value_at_frame: frame index' }
            },
            required: ['operation']
        },
        { type: 'object', properties: { result: {} }, required: ['result'] }, "GET",
        ['animation', 'clip', 'keyframe', 'curve', 'query', 'timeline', 'anim', 'track']
    )
    async animationQuery(args: {
        operation: string, nodeReference?: IInstanceReference, clipReference?: IInstanceReference,
        includeCurves?: boolean, maxCurves?: number, nodePath?: string, propKey?: string, frame?: number
    }): Promise<{ result: any }> {
        let result: any;
        switch (args.operation) {
            case 'root_info':
                result = await Editor.Message.request('scene', 'query-animation-root-info', requireRef(args.nodeReference, 'nodeReference'));
                break;
            case 'root':
                result = await Editor.Message.request('scene', 'query-animation-root', requireRef(args.nodeReference, 'nodeReference'));
                break;
            case 'edit_info':
                result = await Editor.Message.request('scene', 'query-animation-edit-info', requireRef(args.nodeReference, 'nodeReference'));
                break;
            case 'clips_info':
                result = await Editor.Message.request('scene', 'query-animation-clips-info', requireRef(args.nodeReference, 'nodeReference'));
                break;
            case 'clip_dump': {
                const dump = await Editor.Message.request('scene', 'query-animation-clip',
                    requireRef(args.nodeReference, 'nodeReference'), requireRef(args.clipReference, 'clipReference'));
                if (!args.includeCurves || !dump || typeof dump !== 'object' || !Array.isArray(dump.curves)) {
                    result = args.includeCurves ? dump : slimClipDump(dump);
                    break;
                }
                const maxCurves = Math.min(Math.max(args.maxCurves ?? 200, 1), 1000);
                result = { ...dump, curves: dump.curves.slice(0, maxCurves), totalCurves: dump.curves.length, truncated: dump.curves.length > maxCurves };
                break;
            }
            case 'properties':
                result = await Editor.Message.request('scene', 'query-animation-properties', requireRef(args.nodeReference, 'nodeReference'));
                break;
            case 'state':
                result = await Editor.Message.request('scene', 'query-animation-state');
                break;
            case 'current_info':
                result = await Editor.Message.request('scene', 'query-current-animation-info');
                break;
            case 'clip_time':
                result = await Editor.Message.request('scene', 'query-animation-clips-time', requireRef(args.clipReference, 'clipReference'));
                break;
            case 'value_at_frame':
                if (!args.nodePath || !args.propKey || args.frame === undefined) {
                    throw new Error('value_at_frame requires nodePath, propKey and frame');
                }
                result = await Editor.Message.request('scene', 'query-property-value-at-frame',
                    requireRef(args.clipReference, 'clipReference'), args.nodePath, args.propKey, args.frame);
                break;
            default:
                throw new Error(`Unknown animation query operation: ${args.operation}`);
        }
        return { result: result === undefined ? null : result };
    }

    @utcpTool(
        'animationEdit',
        'Edit animation clips: record_start -> operate -> save_clip -> record_stop.',
        {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['record_start', 'record_stop', 'change_root', 'set_edit_clip', 'set_edit_time', 'clip_state', 'save_clip', 'operate']
                },
                nodeReference: InstanceReferenceSchema,
                clipReference: InstanceReferenceSchema,
                time: { type: 'number', description: 'For set_edit_time: playhead time in seconds' },
                clipState: { type: 'string', enum: ['play', 'pause', 'resume', 'stop'], description: 'For clip_state' },
                operations: {
                    type: 'array',
                    maxItems: 100,
                    items: {
                        type: 'object',
                        properties: {
                            funcName: { type: 'string' },
                            args: { type: 'array', items: {} }
                        },
                        required: ['funcName', 'args']
                    }
                }
            },
            required: ['operation']
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                error: { type: 'string' },
                result: { description: 'For operate: the result payload of the animation operation' }
            },
            required: ['success']
        }, "POST",
        ['animation', 'clip', 'keyframe', 'curve', 'record', 'edit', 'timeline', 'anim', 'save']
    )
    async animationEdit(args: {
        operation: string, nodeReference?: IInstanceReference, clipReference?: IInstanceReference,
        time?: number, clipState?: string, operations?: { funcName: string, args: any[] }[]
    }): Promise<ISuccessIndicator & { result?: any }> {
        // Animation has its own undo stack (AnimationUndoManager) driven by recordUndo -
        // a scene snapshot() here would record into the wrong stack while in record mode.
        switch (args.operation) {
            case 'record_start':
            case 'record_stop': {
                const active = args.operation === 'record_start';
                const ok = await Editor.Message.request('scene', 'record-animation',
                    requireRef(args.nodeReference, 'nodeReference'), active, args.clipReference?.id);
                if (!ok) {
                    throw new Error(`Failed to ${active ? 'enter' : 'exit'} animation record mode`);
                }
                return { success: true };
            }
            case 'change_root': {
                const ok = await Editor.Message.request('scene', 'change-animation-root',
                    requireRef(args.nodeReference, 'nodeReference'), requireRef(args.clipReference, 'clipReference'));
                return { success: !!ok };
            }
            case 'set_edit_clip': {
                const ok = await Editor.Message.request('scene', 'change-edit-clip', requireRef(args.clipReference, 'clipReference'));
                return { success: !!ok };
            }
            case 'set_edit_time': {
                if (args.time === undefined) {
                    throw new Error('set_edit_time requires time');
                }
                const ok = await Editor.Message.request('scene', 'set-edit-time', args.time);
                return { success: !!ok };
            }
            case 'clip_state': {
                if (!args.clipState) {
                    throw new Error('clip_state requires clipState');
                }
                const ok = await Editor.Message.request('scene', 'change-clip-state',
                    args.clipState, requireRef(args.clipReference, 'clipReference'));
                return { success: !!ok };
            }
            case 'save_clip': {
                const ok = await Editor.Message.request('scene', 'save-clip');
                if (!ok) {
                    throw new Error('Failed to save the animation clip (is the editor in record mode?)');
                }
                return { success: true };
            }
            case 'operate': {
                if (!Array.isArray(args.operations) || args.operations.length === 0) {
                    throw new Error('operate requires a non-empty operations array');
                }
                if (args.operations.length > 100) {
                    throw new Error('operate supports at most 100 operations per request');
                }
                for (const op of args.operations) {
                    if (!op || !op.funcName || !Array.isArray(op.args)) {
                        throw new Error('each operation requires funcName and an args array');
                    }
                }
                const res: any = await Editor.Message.request('scene', 'animation-operation', args.operations, { recordUndo: true });
                // IAniResultBase: { state: 'success' | 'failure', result, reason? }.
                // Whitelist success — an absent or unknown state is a refused/lost write.
                if (res && res.state === 'failure') {
                    return { success: false, error: res.reason || 'animation operation failed', result: res.result ?? null };
                }
                if (!res || res.state !== 'success') {
                    throw new Error(`animation-operation returned an unexpected payload: ${JSON.stringify(res ?? null)}`);
                }
                return { success: true, result: 'result' in res ? res.result : null };
            }
            default:
                throw new Error(`Unknown animation edit operation: ${args.operation}`);
        }
    }
}
