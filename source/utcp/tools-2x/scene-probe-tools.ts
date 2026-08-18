import { utcpTool } from '../decorators';
import { sceneScript as callSceneScript } from '../utils/ipc-promise';

/**
 * Tam: probe handler chung de chay cac probe trong scene process.
 * Xoa sau khi probe xong.
 */
export class SceneProbeTools {

    @utcpTool(
        'sceneScript',
        'Call any scene-script handler in the scene process. For probing and advanced scene access.',
        {
            type: 'object',
            properties: {
                handler: { type: 'string', description: 'Handler name: e.g. probe-getInstanceById, probe-scene-utils, probe-set-prop, open-scene, scene-info' },
                arg1: { type: 'string', description: 'First arg (e.g. uuid for probe-getInstanceById, path for probe-set-prop)' },
                arg2: {},
            },
            required: ['handler'],
        },
        { type: 'object', properties: { result: {} }, required: ['result'] },
        'GET', ['scene', 'probe', 'debug']
    )
    async sceneScript(args: { handler: string, arg1?: string, arg2?: any }): Promise<any> {
        const params: any[] = [];
        if (args.arg1 !== undefined) { params.push(args.arg1); }
        if (args.arg2 !== undefined) { params.push(args.arg2); }
        const result = await callSceneScript<any>(args.handler, ...params);
        return { result };
    }
}
