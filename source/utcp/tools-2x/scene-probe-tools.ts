import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

/**
 * Tam: probe handler chung de chay cac probe trong scene process.
 * Xoa sau khi probe xong.
 */
export class SceneProbeTools {

    @utcpTool(
        'sceneProbe',
        'Run a probe handler in the scene process. For write-train unblocking only.',
        {
            type: 'object',
            properties: {
                handler: { type: 'string', description: 'Handler name: probe-getInstanceById, probe-scene-utils, probe-set-prop' },
                arg1: { type: 'string', description: 'First arg (e.g. uuid for probe-getInstanceById, path for probe-set-prop)' },
                arg2: {},
            },
            required: ['handler'],
        },
        { type: 'object', properties: { result: {} }, required: ['result'] },
        'GET', ['scene', 'probe', 'debug']
    )
    async sceneProbe(args: { handler: string, arg1?: string, arg2?: any }): Promise<any> {
        const valid = ['probe-getInstanceById', 'probe-scene-utils', 'probe-set-prop', 'probe', 'probe2'];
        if (!valid.includes(args.handler)) {
            throw new Error(`Unknown handler: ${args.handler}. Valid: ${valid.join(', ')}`);
        }
        const params: any[] = [];
        if (args.arg1 !== undefined) { params.push(args.arg1); }
        if (args.arg2 !== undefined) { params.push(args.arg2); }
        const result = await sceneScript<any>(args.handler, ...params);
        return { result };
    }
}
