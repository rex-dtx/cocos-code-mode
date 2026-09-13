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

type AnimationOperation = { funcName: string, args: unknown[] };

async function applyAnimationOperation(funcName: string, args: unknown[]): Promise<ISuccessIndicator & { result?: unknown }> {
    const response: any = await Editor.Message.request('scene', 'animation-operation', [{ funcName, args }], { recordUndo: true });
    if (response && response.state === 'failure') {
        return { success: false, error: response.reason || 'animation operation failed', result: response.result ?? null };
    }
    if (!response || response.state !== 'success') {
        throw new Error(`animation-operation returned an unexpected payload: ${JSON.stringify(response ?? null)}`);
    }
    return { success: true, result: 'result' in response ? response.result : null };
}

function requireText(value: unknown, name: string, maxLength = 512): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${name} must be a non-empty string of at most ${maxLength} characters.` });
    }
    return value;
}

async function applyToClip(clipReference: IInstanceReference | undefined, funcName: string, args: unknown[]): Promise<ISuccessIndicator & { result?: unknown }> {
    const clipId = requireRef(clipReference, 'clipReference');
    const selected = await Editor.Message.request('scene', 'change-edit-clip', clipId);
    if (!selected) {
        throw new ToolError({ code: 'ANIMATION_CLIP_SELECTION_FAILED', status: 409, message: `Creator could not select animation clip ${clipId} for editing.` });
    }
    return applyAnimationOperation(funcName, args);
}

function requireFrame(value: unknown, name = 'frame'): number {
    if (!Number.isInteger(value) || !Number.isFinite(value) || Number(value) < 0 || Number(value) > 1_000_000) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${name} must be an integer from 0 to 1000000.` });
    }
    return Number(value);
}

function requireFrames(value: unknown, name = 'frames'): number[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${name} must contain 1 to 200 frame indices.` });
    }
    return value.map((frame, index) => requireFrame(frame, `${name}[${index}]`));
}

function requireOperations(value: unknown): AnimationOperation[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operations must contain 1 to 100 animation operations.' });
    }
    return value.map((operation, index) => {
        if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `operations[${index}] must be an object.` });
        }
        const candidate = operation as Record<string, unknown>;
        return { funcName: requireText(candidate.funcName, `operations[${index}].funcName`, 128), args: Array.isArray(candidate.args) ? candidate.args : (() => { throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `operations[${index}].args must be an array.` }); })() };
    });
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
    @utcpTool(
        'animationClipConfigure',
        'Configure native animation clip sample rate, speed, or wrap mode through verified animation operations.',
        {
            type: 'object',
            properties: {
                clipReference: InstanceReferenceSchema,
                operation: { type: 'string', enum: ['sample', 'speed', 'wrap_mode'] },
                value: { type: 'number' }
            },
            required: ['clipReference', 'operation', 'value']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, result: {} }, required: ['success'] },
        'POST', ['animation', 'clip', 'configure', 'sample', 'speed', 'wrap']
    )
    async animationClipConfigure(args: { clipReference?: IInstanceReference, operation?: string, value?: number }): Promise<ISuccessIndicator & { result?: unknown }> {
        requireRef(args?.clipReference, 'clipReference');
        if (!['sample', 'speed', 'wrap_mode'].includes(args?.operation ?? '')) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operation must be sample, speed, or wrap_mode.' });
        }
        if (typeof args?.value !== 'number' || !Number.isFinite(args.value)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'value must be a finite number.' });
        }
        if (args.operation === 'sample' && (args.value < 1 || args.value > 240)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'sample must be between 1 and 240.' });
        }
        if (args.operation === 'speed' && (args.value < 0 || args.value > 100)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'speed must be between 0 and 100.' });
        }
        const funcName = args.operation === 'wrap_mode' ? 'changeWrapMode' : args.operation === 'sample' ? 'changeSample' : 'changeSpeed';
        return applyToClip(args.clipReference, funcName, [args.value]);
    }

    @utcpTool(
        'animationTrackEdit',
        'Create, remove, move, or copy native animation property tracks with bounded typed arguments.',
        {
            type: 'object',
            properties: {
                clipReference: InstanceReferenceSchema,
                operation: { type: 'string', enum: ['create', 'remove', 'move_node', 'copy_to'] },
                nodePath: { type: 'string' },
                propKey: { type: 'string' },
                destinationNodePath: { type: 'string' },
                destinationPropKey: { type: 'string' }
            },
            required: ['clipReference', 'operation', 'nodePath', 'propKey']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, result: {} }, required: ['success'] },
        'POST', ['animation', 'track', 'curve', 'edit']
    )
    async animationTrackEdit(args: { clipReference?: IInstanceReference, operation?: string, nodePath?: string, propKey?: string, destinationNodePath?: string, destinationPropKey?: string }): Promise<ISuccessIndicator & { result?: unknown }> {
        const operation = args?.operation;
        const nodePath = requireText(args?.nodePath, 'nodePath');
        const propKey = requireText(args?.propKey, 'propKey');
        if (operation === 'create') return applyToClip(args.clipReference, 'createProp', [nodePath, propKey]);
        if (operation === 'remove') return applyToClip(args.clipReference, 'removeProp', [nodePath, propKey]);
        const destinationNodePath = requireText(args?.destinationNodePath, 'destinationNodePath');
        const destinationPropKey = requireText(args?.destinationPropKey, 'destinationPropKey');
        if (operation === 'move_node') return applyToClip(args.clipReference, 'changeNodeDataPath', [nodePath, destinationNodePath]);
        if (operation === 'copy_to') return applyToClip(args.clipReference, 'copyPropTo', [nodePath, propKey, destinationNodePath, destinationPropKey]);
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operation must be create, remove, move_node, or copy_to.' });
    }

    @utcpTool(
        'animationKeyframeEdit',
        'Create, move, remove, copy, space, clear, or retime native animation keyframes.',
        {
            type: 'object',
            properties: {
                clipReference: InstanceReferenceSchema,
                operation: { type: 'string', enum: ['create', 'move', 'remove', 'update', 'copy_to', 'spacing', 'clear', 'modify_curve'] },
                nodePath: { type: 'string' },
                propKey: { type: 'string' },
                frame: { type: 'integer', minimum: 0, maximum: 1000000 },
                frames: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer', minimum: 0, maximum: 1000000 } },
                offsets: { oneOf: [{ type: 'integer' }, { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer' } }] },
                destinationFrame: { type: 'integer', minimum: 0, maximum: 1000000 },
                spacingFrames: { type: 'integer', minimum: 0, maximum: 1000000 },
                customData: {}
            },
            required: ['clipReference', 'operation', 'nodePath', 'propKey']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, result: {} }, required: ['success'] },
        'POST', ['animation', 'keyframe', 'curve', 'edit']
    )
    async animationKeyframeEdit(args: { clipReference?: IInstanceReference, operation?: string, nodePath?: string, propKey?: string, frame?: number, frames?: number[], offsets?: number | number[], destinationFrame?: number, spacingFrames?: number, customData?: unknown, curveData?: unknown }): Promise<ISuccessIndicator & { result?: unknown }> {
        const operation = args?.operation;
        const nodePath = requireText(args?.nodePath, 'nodePath');
        const propKey = requireText(args?.propKey, 'propKey');
        if (operation === 'create') return applyToClip(args.clipReference, 'createKey', [nodePath, propKey, requireFrame(args?.frame), args?.customData ?? null]);
        if (operation === 'move') return applyToClip(args.clipReference, 'moveKeys', [nodePath, propKey, requireFrames(args?.frames), args?.offsets ?? 0]);
        if (operation === 'remove') return applyToClip(args.clipReference, 'removeKey', [nodePath, propKey, requireFrames(args?.frames)]);
        if (operation === 'update') return applyToClip(args.clipReference, 'updateKey', [nodePath, propKey, requireFrames(args?.frames)]);
        if (operation === 'copy_to') return applyToClip(args.clipReference, 'copyKeysTo', [nodePath, propKey, requireFrames(args?.frames), requireFrame(args?.destinationFrame, 'destinationFrame')]);
        if (operation === 'spacing') return applyToClip(args.clipReference, 'spacingKeys', [nodePath, propKey, requireFrames(args?.frames), requireFrame(args?.spacingFrames, 'spacingFrames')]);
        if (operation === 'clear') return applyToClip(args.clipReference, 'clearKeys', [nodePath, propKey]);
        if (operation === 'modify_curve') return applyToClip(args.clipReference, 'modifyCurveOfKey', [nodePath, propKey, requireFrame(args?.frame), args?.curveData ?? args?.customData ?? null]);
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operation must be create, move, remove, update, copy_to, spacing, clear, or modify_curve.' });
    }

    @utcpTool(
        'animationEventEdit',
        'Add, update, move, copy, or delete ordered animation event keyframes.',
        {
            type: 'object',
            properties: {
                clipReference: InstanceReferenceSchema,
                operation: { type: 'string', enum: ['add', 'update', 'move', 'copy_to', 'delete'] },
                frame: { type: 'integer', minimum: 0, maximum: 1000000 },
                frames: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer', minimum: 0, maximum: 1000000 } },
                destinationFrame: { type: 'integer', minimum: 0, maximum: 1000000 },
                offset: { type: 'integer', minimum: -1000000, maximum: 1000000 },
                functionName: { type: 'string', minLength: 1, maxLength: 256 },
                parameters: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 1024 } },
                events: { type: 'array', maxItems: 200, items: { type: 'object' } }
            },
            required: ['clipReference', 'operation']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, result: {} }, required: ['success'] },
        'POST', ['animation', 'event', 'keyframe', 'edit']
    )
    async animationEventEdit(args: { clipReference?: IInstanceReference, operation?: string, frame?: number, frames?: number[], destinationFrame?: number, offset?: number, functionName?: string, parameters?: string[], events?: unknown[] }): Promise<ISuccessIndicator & { result?: unknown }> {
        const operation = args?.operation;
        if (operation === 'add') return applyToClip(args.clipReference, 'addEvent', [requireFrame(args?.frame), requireText(args?.functionName, 'functionName', 256), args?.parameters ?? []]);
        if (operation === 'delete') return applyToClip(args.clipReference, 'deleteEvent', [requireFrames(args?.frames)]);
        if (operation === 'update') return applyToClip(args.clipReference, 'updateEvent', [requireFrames(args?.frames), Array.isArray(args?.events) ? args.events : (() => { throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'events must be an array.' }); })()]);
        if (operation === 'move') {
            if (!Number.isInteger(args?.offset) || !Number.isFinite(args.offset)) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'offset must be an integer.' });
            return applyToClip(args.clipReference, 'moveEvents', [requireFrames(args?.frames), args.offset]);
        }
        if (operation === 'copy_to') return applyToClip(args.clipReference, 'copyEventsTo', [requireFrames(args?.frames), requireFrame(args?.destinationFrame, 'destinationFrame')]);
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operation must be add, update, move, copy_to, or delete.' });
    }
    @utcpTool(
        'animationAuxCurveEdit',
        'Manage bounded auxiliary animation curves and keys through native editor operations.',
        {
            type: 'object',
            properties: {
                clipReference: InstanceReferenceSchema,
                name: { type: 'string', minLength: 1, maxLength: 256 },
                operation: { type: 'string', enum: ['add', 'rename', 'remove', 'create_key', 'remove_key', 'move_keys', 'copy_key', 'modify_curve'] },
                newName: { type: 'string', maxLength: 256 },
                frame: { type: 'integer', minimum: 0, maximum: 1000000 },
                frames: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer', minimum: 0, maximum: 1000000 } },
                offset: { oneOf: [{ type: 'integer' }, { type: 'array', minItems: 1, maxItems: 200, items: { type: 'integer' } }] },
                customData: {},
                curveData: {},
                source: {},
                destination: {}
            },
            required: ['clipReference', 'operation', 'name']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, result: {} }, required: ['success'] },
        'POST', ['animation', 'auxiliary', 'curve', 'keyframe', 'edit']
    )
    async animationAuxCurveEdit(args: { clipReference?: IInstanceReference, operation?: string, name?: string, newName?: string, frame?: number, frames?: number[], offset?: number | number[], customData?: unknown, curveData?: unknown, source?: unknown, destination?: unknown }): Promise<ISuccessIndicator & { result?: unknown }> {
        const operation = args?.operation;
        const name = requireText(args?.name, 'name', 256);
        if (operation === 'add') return applyToClip(args.clipReference, 'addAuxiliaryCurve', [name]);
        if (operation === 'rename') return applyToClip(args.clipReference, 'renameAuxiliaryCurve', [name, requireText(args?.newName, 'newName', 256)]);
        if (operation === 'remove') return applyToClip(args.clipReference, 'removeAuxiliaryCurve', [name]);
        if (operation === 'create_key') return applyToClip(args.clipReference, 'createAuxKey', [name, requireFrame(args?.frame), args?.customData]);
        if (operation === 'remove_key') return applyToClip(args.clipReference, 'removeAuxKey', [name, requireFrame(args?.frame)]);
        if (operation === 'move_keys') return applyToClip(args.clipReference, 'moveAuxKeys', [name, requireFrames(args?.frames), args?.offset ?? 0]);
        if (operation === 'copy_key') {
            if (!args?.source || !args?.destination || typeof args.source !== 'object' || typeof args.destination !== 'object') {
                throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'copy_key requires source and destination objects.' });
            }
            return applyToClip(args.clipReference, 'copyAuxKey', [args.source, args.destination]);
        }
        if (operation === 'modify_curve') return applyToClip(args.clipReference, 'modifyAuxCurveOfKey', [name, requireFrame(args?.frame), args?.curveData ?? args?.customData ?? null]);
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'operation must be add, rename, remove, create_key, remove_key, move_keys, copy_key, or modify_curve.' });
    }

    @utcpTool(
        'animationUsageAnalyze',
        'Inspect scene animation usage, active states, defaults, cache modes, and actionable setup recommendations.',
        {
            type: 'object',
            properties: {
                nodeReference: InstanceReferenceSchema,
                maxNodes: { type: 'integer', minimum: 1, maximum: 200, default: 100 }
            }
        },
        {
            type: 'object',
            properties: {
                nodeReference: InstanceReferenceSchema,
                visitedNodes: { type: 'integer' },
                truncated: { type: 'boolean' },
                componentCount: { type: 'integer' },
                findings: { type: 'array' }
            },
            required: ['nodeReference', 'visitedNodes', 'truncated', 'componentCount', 'findings']
        },
        'GET', ['animation', 'analyze', 'usage', 'setup', 'cache', 'recommend']
    )
    async animationUsageAnalyze(args: { nodeReference?: IInstanceReference, maxNodes?: number } = {}): Promise<Record<string, unknown>> {
        if (args.maxNodes !== undefined && (!Number.isInteger(args.maxNodes) || args.maxNodes < 1 || args.maxNodes > 200)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'maxNodes must be an integer from 1 to 200.' });
        }
        if (args.nodeReference) requireRef(args.nodeReference, 'nodeReference');
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cc-bridge-3x',
            method: 'animationUsageAnalyze',
            args: [{ nodeUuid: args.nodeReference?.id, maxNodes: args.maxNodes ?? 100 }],
        }) as Record<string, unknown> | null;
        if (!result || !Array.isArray(result.findings) || typeof result.componentCount !== 'number') {
            throw new ToolError({ code: 'ANIMATION_ANALYSIS_FAILED', status: 502, message: 'Creator returned malformed animation usage analysis.' });
        }
        return { ...result, nodeReference: { id: String(result.nodeUuid ?? args.nodeReference?.id ?? ''), type: 'cc.Node' } };
    }

    @utcpTool(
        'animationRuntimeControl',
        'Fully control Animation playback/state and Spine or DragonBones cache mode with live read-back.',
        {
            type: 'object',
            properties: {
                nodeReference: InstanceReferenceSchema,
                operation: { type: 'string', enum: ['inspect', 'play', 'cross_fade', 'pause', 'resume', 'stop', 'set_default', 'set_play_on_load', 'set_state', 'set_cache_mode', 'invalidate_cache'] },
                clipName: { type: 'string', maxLength: 256 },
                duration: { type: 'number', minimum: 0, maximum: 60 },
                playOnLoad: { type: 'boolean' },
                loop: { type: 'boolean' },
                speed: { type: 'number', minimum: 0, maximum: 100 },
                time: { type: 'number', minimum: 0, maximum: 86400 },
                repeatCount: { type: 'number', minimum: 0, maximum: 1000000 },
                wrapMode: { type: 'integer', minimum: 0, maximum: 100 },
                cacheMode: { type: 'string', enum: ['REALTIME', 'SHARED_CACHE', 'PRIVATE_CACHE'] }
            },
            required: ['nodeReference', 'operation']
        },
        {
            type: 'object',
            properties: {
                nodeReference: InstanceReferenceSchema,
                operation: { type: 'string' },
                animation: {},
                spine: {},
                dragonBones: {}
            },
            required: ['nodeReference', 'operation']
        },
        'POST', ['animation', 'runtime', 'playback', 'state', 'cache', 'spine', 'dragonbones']
    )
    async animationRuntimeControl(args: {
        nodeReference?: IInstanceReference,
        operation?: string,
        clipName?: string,
        duration?: number,
        playOnLoad?: boolean,
        loop?: boolean,
        speed?: number,
        time?: number,
        repeatCount?: number,
        wrapMode?: number,
        cacheMode?: string,
    }): Promise<Record<string, unknown>> {
        const nodeUuid = requireRef(args?.nodeReference, 'nodeReference');
        const operations = ['inspect', 'play', 'cross_fade', 'pause', 'resume', 'stop', 'set_default', 'set_play_on_load', 'set_state', 'set_cache_mode', 'invalidate_cache'];
        if (!operations.includes(args?.operation ?? '')) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `operation must be one of ${operations.join(', ')}.` });
        if (args.clipName !== undefined) requireText(args.clipName, 'clipName', 256);
        const ranges: Array<[keyof typeof args, number, number]> = [['duration', 0, 60], ['speed', 0, 100], ['time', 0, 86400], ['repeatCount', 0, 1_000_000]];
        for (const [key, min, max] of ranges) {
            const value = args[key];
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
                throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${String(key)} must be a finite number from ${min} to ${max}.` });
            }
        }
        if (args.wrapMode !== undefined && (!Number.isInteger(args.wrapMode) || args.wrapMode < 0 || args.wrapMode > 100)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'wrapMode must be an integer from 0 to 100.' });
        }
        if (args.cacheMode !== undefined && !['REALTIME', 'SHARED_CACHE', 'PRIVATE_CACHE'].includes(args.cacheMode)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'cacheMode must be REALTIME, SHARED_CACHE, or PRIVATE_CACHE.' });
        }
        if (args.operation === 'cross_fade' && !args.clipName) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'cross_fade requires clipName.' });
        }
        if (args.operation === 'set_default' && !args.clipName) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'set_default requires clipName.' });
        }
        if (args.operation === 'set_play_on_load' && typeof args.playOnLoad !== 'boolean') {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'set_play_on_load requires playOnLoad.' });
        }
        if (args.operation === 'set_state' && (!args.clipName || [args.speed, args.time, args.repeatCount, args.wrapMode].every((value) => value === undefined))) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'set_state requires clipName and at least one state field.' });
        }
        if (args.operation === 'set_cache_mode' && !args.cacheMode) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'set_cache_mode requires cacheMode.' });
        }
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cc-bridge-3x',
            method: 'animationRuntimeControl',
            args: [{ ...args, nodeUuid, nodeReference: undefined }],
        }) as Record<string, unknown> | null;
        if (!result || typeof result !== 'object') throw new ToolError({ code: 'ANIMATION_CONTROL_FAILED', status: 502, message: 'Creator returned no animation control read-back.' });
        return { ...result, nodeReference: { id: nodeUuid, type: 'cc.Node' }, operation: args.operation };
    }
}
