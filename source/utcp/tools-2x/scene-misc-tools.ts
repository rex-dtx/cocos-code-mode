import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

/**
 * Scene open + info. 2.4 khong co Editor.Message('scene', 'open-scene');
 * dung sceneScript: _Scene.loadSceneByUuid(uuid). Info doc truc tiep tu cc.director.
 * ponytail: chi 2 op read-only ngoai tree/dump — can de mo scene truoc khi mutate.
 */
export class SceneMiscTools {

    @utcpTool(
        'sceneOpen',
        'Open a scene asset by uuid or db:// url. Use after assetQuery search to jump to a scene.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Scene asset uuid' },
                url: { type: 'string', description: 'Scene db:// url, e.g. db://assets/Scene/helloworld.fire' },
            },
        },
        { type: 'object', properties: { success: { type: 'boolean' }, uuid: { type: 'string' } }, required: ['success'] },
        'POST', ['scene', 'open', 'load', 'level']
    )
    async sceneOpen(args: { uuid?: string, url?: string }): Promise<{ success: boolean, uuid: string }> {
        const uuid = args.uuid || (args.url ? Editor.assetdb.urlToUuid(args.url) : null);
        if (!uuid) { throw new Error('sceneOpen requires uuid or url'); }
        const info = Editor.assetdb.assetInfoByUuid(uuid);
        if (!info) { throw new Error(`Scene asset not found: ${uuid}`); }
        await sceneScript<any>('open-scene', uuid);
        return { success: true, uuid };
    }

    @utcpTool(
        'sceneNew',
        'Create a new empty scene (scene:new-scene IPC). Fire-and-forget like save_scene — save the current scene first if it is dirty.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { success: { type: 'boolean' }, note: { type: 'string' } }, required: ['success'] },
        'POST', ['scene', 'new', 'create', 'empty']
    )
    async sceneNew(): Promise<any> {
        // asset-management docs: Editor.Ipc.sendToPanel('scene','scene:new-scene').
        // Khong await cb — lifecycle message co the khong reply (giong scene:stash-and-save, 10s timeout).
        Editor.Ipc.sendToPanel('scene', 'scene:new-scene' as any);
        return { success: true, note: 'fire-and-forget; verify with sceneInfo' };
    }

    @utcpTool(
        'prefabSync',
        'Apply prefab instance changes back to the prefab asset (scene:set-prefab-sync, forum reply #41). Fire-and-forget.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Prefab asset uuid (or instance node uuid per forum snippet)' },
            },
            required: ['uuid'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, note: { type: 'string' } }, required: ['success'] },
        'POST', ['prefab', 'sync', 'apply', 'save']
    )
    async prefabSync(args: { uuid: string }): Promise<any> {
        if (!args.uuid) { throw new Error('uuid is required'); }
        Editor.Ipc.sendToPanel('scene', 'scene:set-prefab-sync' as any, args.uuid);
        return { success: true, note: 'fire-and-forget; message from forum #41, chua verify runtime' };
    }

    @utcpTool(
        'sceneInfo',
        'Get current scene header: name, uuid, designResolution, node count.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                name: { type: 'string' },
                uuid: { type: 'string' },
                designResolution: { type: 'object' },
                nodesVisited: { type: 'number' },
            },
        },
        'GET', ['scene', 'info', 'current', 'header', 'bounds', 'dirty']
    )
    async sceneInfo(): Promise<any> {
        const base: any = await sceneScript<any>('scene-info');
        try {
            const bounds: any = await new Promise((resolve, reject) => {
                Editor.Ipc.sendToPanel('scene', 'scene:query-scene-bounds' as any, (err: any, res: any) => err ? reject(err) : resolve(res));
            });
            if (bounds) base.bounds = bounds;
        } catch {}
        try {
            const dirty: any = await new Promise((resolve, reject) => {
                Editor.Ipc.sendToPanel('scene', 'scene:query-dirty' as any, (err: any, res: any) => err ? reject(err) : resolve(res));
            });
            base.dirty = !!dirty;
            if (!base.bounds && base.designResolution) base.bounds = base.designResolution;
        } catch {}
        return base;
    }
}
