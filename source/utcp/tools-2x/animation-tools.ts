import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

// 2.4 Animation = cc.Animation (not Animator). Clip info lives on the component,
// not a separate facade. No scene messages exist for query-animation-* on 2.4,
// so query via scene-script component-props instead.

export class AnimationTools2x {
    @utcpTool(
        'animationQuery',
        'Query animation data on 2.4 (cc.Animation). clips_info = list clips on node; clip_dump = one clip asset info (slim); properties = all Animation props. Use nodeUuid or path (cc.find).',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['clips_info', 'clip_dump', 'properties', 'state'], description: 'clips_info|clip_dump|properties|state' },
                nodeUuid: { type: 'string', description: 'Node with cc.Animation' },
                path: { type: 'string', description: 'Alternative to nodeUuid: cc.find path' },
                clipName: { type: 'string', description: 'For clip_dump: clip name or url' },
                includeCurves: { type: 'boolean', description: 'For clip_dump: include full curves (large)', default: false },
            },
            required: ['operation'],
        },
        { type: 'object', properties: { result: {} }, required: ['result'] },
        'GET', ['animation', 'clip', 'query', 'anim']
    )
    async animationQuery(args: { operation: string, nodeUuid?: string, path?: string, clipName?: string, includeCurves?: boolean }): Promise<any> {
        const op = args.operation;
        if (!args.nodeUuid && !args.path) throw new Error('animationQuery requires nodeUuid or path');
        // Resolve node -> we need uuid for scene-script; if path given, resolve via assetdb/node query?
        // Reuse nodeQuery at_path to get uuid if path provided
        let uuid = args.nodeUuid || '';
        if (!uuid && args.path) {
            const { panelIpc } = await import('../utils/ipc-promise');
            try {
                const node: any = await panelIpc('scene', 'scene:query-node', args.path);
                uuid = node?.uuid || node?.id || '';
            } catch {}
            if (!uuid) {
                // fallback: ask scene-script via cc.find
                const info: any = await sceneScript('node-at-path', { path: args.path });
                uuid = info?.uuid || '';
            }
            if (!uuid) throw new Error(`Node not found at path "${args.path}"`);
        }

        // Fetch cc.Animation props via scene-script component-props (generic handler)
        // Use sceneScript('component-props', path, 'cc.Animation') needs path; so we need path string.
        // If we only have uuid, find path via find-by-asset? Simpler: use direct props via new handler.
        // Fallback: use sceneScript probe for animation component
        const fetchAnimProps = async (): Promise<any> => {
            // Try scene-script helpers: component-props expects cc.find path
            // Try to get node path via parent walk: use scene-snapshot to locate path
            // Simplest: call component-props via path if we have path, else try uuid-based handler we add on demand
            if (args.path) {
                try { return await sceneScript('component-props', args.path, 'cc.Animation'); } catch {}
            }
            // Try generic animation-props handler if exists, else fallback to node dump
            try {
                const dump: any = await sceneScript('probe-animation', uuid);
                if (dump) return dump;
            } catch {}
            return null;
        };

        let props: any = await fetchAnimProps();
        if (!props) {
            // Last resort: node dump contains components but not clip details — return note
            return { result: { note: 'cc.Animation not found or probe-animation handler missing — is scene-script up to date?', uuid } };
        }

        switch (op) {
            case 'clips_info': {
                const clips = props.clips || props._clips || [];
                const slim = Array.isArray(clips) ? clips.map((c: any) => ({
                    name: c?.name || c?._name || null,
                    uuid: c?.uuid || c?._uuid || null,
                    duration: c?.duration ?? null,
                    sample: c?.sample ?? null,
                    wrapMode: c?.wrapMode ?? null,
                })) : [];
                return { result: { uuid, clipCount: slim.length, clips: slim, defaultClip: props.defaultClip || props._defaultClip || null, playOnLoad: props.playOnLoad } };
            }
            case 'clip_dump': {
                const clips: any[] = props.clips || props._clips || [];
                const name = args.clipName || '';
                let clip: any = clips.find((c: any) => (c?.name || c?._name) === name) || clips[0] || null;
                if (!clip) return { result: null };
                if (!args.includeCurves) {
                    const curves = Array.isArray(clip.curveData) ? clip.curveData : (Array.isArray(clip.curves) ? clip.curves : []);
                    return { result: { name: clip.name || clip._name, duration: clip.duration, sample: clip.sample, wrapMode: clip.wrapMode, curveCount: curves.length, uuid: clip.uuid || clip._uuid } };
                }
                return { result: clip };
            }
            case 'properties':
                return { result: props };
            case 'state': {
                // 2.4 Animation state: isPlaying etc are runtime, not serializable — return what we have
                return { result: { uuid, isPlaying: props.isPlaying ?? null, currentClip: props.currentClip || null, props } };
            }
            default:
                throw new Error(`Unknown animationQuery operation: ${op}`);
        }
    }

    @utcpTool(
        'animationEdit',
        'Edit animation clip on 2.4 — not supported via scene messages. Edit .anim files directly via assetWriteContent. This tool returns guidance.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['record_start', 'record_stop', 'save_clip', 'operate'], description: 'Use assetWriteContent instead on 2.4' },
                nodeUuid: { type: 'string' },
            },
            required: ['operation'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, note: { type: 'string' } }, required: ['success'] },
        'POST', ['animation', 'clip', 'edit', 'anim']
    )
    async animationEdit(args: { operation: string }): Promise<any> {
        throw new Error(`animationEdit ${args.operation} not supported on Creator 2.4 — .anim is a JSON asset, edit via assetWriteContent or in editor. 3x7 messages (record-animation, animation-operation) do not exist on 2.4.`);
    }
}
