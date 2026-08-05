import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator } from '../schemas';

// Animation editing lives in the `scene` module (not only the animator panel).
// Messages are runtime-only (absent from typed message.d.ts); signatures mirror
// AnimationSceneFacade in @types/cce/3d/facade/animation-scene-facade.d.ts.

function requireRef(ref: IInstanceReference | undefined, what: string): string {
    if (!ref || !ref.id) {
        throw new Error(`${what} is required`);
    }
    return ref.id;
}

// Clip dumps carry every curve and keyframe - easily tens of thousands of tokens.
// Default to a slim view; full curves only on explicit request.
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
        events: dump.events,
        curveCount: curves.length,
        tracks: curves.map((c: any) => ({
            nodePath: c?.nodePath,
            key: c?.key,
            displayName: c?.displayName,
            keyframeCount: Array.isArray(c?.keyframes) ? c.keyframes.length : 0
        }))
    };
}

export class AnimationTools {

    @utcpTool(
        'animationQuery',
        'Read animation data of the current scene. Start with "root_info" on any node - it walks up to the animation root and returns its clip menu, current clip dump, play state and time. Other operations: "root" (uuid of the animation root above a node), "edit_info" (which clips a node can edit), "clips_info" (clip list of a node), "clip_dump" (one clip - slim by default), "properties" (animatable properties of a node), "state"/"current_info" (playback of the clip being edited), "clip_time" (current time of a clip), "value_at_frame" (value of one property track at a frame).',
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
        includeCurves?: boolean, nodePath?: string, propKey?: string, frame?: number
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
                result = args.includeCurves ? dump : slimClipDump(dump);
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
        'Edit animation clips. Workflow: "record_start" on the animation root node (with the clip to edit) puts the editor in animation record mode, then "operate" applies curve/keyframe changes, then "save_clip" writes them to the asset, then "record_stop". Other operations: "change_root" (switch the node being animated - needs both nodeReference and clipReference), "set_edit_clip" (switch clip), "set_edit_time" (move the playhead), "clip_state" (play/pause/resume/stop the previewed clip). Query the current state first with animationQuery root_info.',
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
                    description: 'For operate: list of clip operations applied in order. funcName is a method of the editor clip, e.g. createProp(nodePath, propKey), removeProp(nodePath, propKey), createKey(nodePath, propKey, frame, customData), removeKey(nodePath, propKey, frames[]), moveKeys(nodePath, propKey, frames[], offsets), clearKeys(nodePath, propKey), changeSample(sample), changeSpeed(speed), changeWrapMode(mode), addEvent(frame, funcName, params[]), deleteEvent(frames[]), removeNode(nodePath). args is the positional argument list of that method.',
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
                for (const op of args.operations) {
                    if (!op || !op.funcName || !Array.isArray(op.args)) {
                        throw new Error('each operation requires funcName and an args array');
                    }
                }
                const res: any = await Editor.Message.request('scene', 'animation-operation', args.operations, { recordUndo: true });
                // IAniResultBase: { state: 'success' | 'failure', result, reason? }
                if (res && res.state === 'failure') {
                    return { success: false, error: res.reason || 'animation operation failed', result: res.result ?? null };
                }
                return { success: true, result: res && 'result' in res ? res.result : (res ?? null) };
            }
            default:
                throw new Error(`Unknown animation edit operation: ${args.operation}`);
        }
    }
}
