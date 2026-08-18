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
        'sceneInfo',
        'Info about the currently open scene: name, uuid, designResolution and node count. Lighter than sceneSnapshot when you only need the header.',
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
        return sceneScript<any>('scene-info');
    }
}
