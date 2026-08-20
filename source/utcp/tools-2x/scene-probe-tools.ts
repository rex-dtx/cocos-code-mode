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

    @utcpTool(
        'probeSceneIpc',
        'Phase B gate: fire 14 candidate scene:* IPC messages from the MAIN process with a fake uuid (mutate no-op), ' +
        'classify each as exists/closed/timeout. Returns per-msg verdict. Use before porting a scene IPC tool.',
        {
            type: 'object',
            properties: {
                timeoutMs: { type: 'number', description: 'Per-message reply timeout, default 5000' },
            },
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } }, summary: { type: 'object' } }, required: ['results'] },
        'GET', ['scene', 'probe', 'ipc', 'phase-b', 'gate']
    )
    async probeSceneIpc(args: { timeoutMs?: number }): Promise<any> {
        const timeoutMs = args.timeoutMs || 5000;
        const FAKE = '00000000-0000-0000-0000-00000000probe';
        const msgs: Array<{ msg: string; args: any[] }> = [
            { msg: 'scene:create-node-by-classid', args: ['2d.renderer', FAKE] },
            { msg: 'scene:add-component', args: [FAKE, 'cc.Sprite'] },
            { msg: 'scene:remove-component', args: [FAKE, 'cc.Sprite'] },
            { msg: 'scene:copy-nodes', args: [[FAKE]] },
            { msg: 'scene:paste-nodes', args: [] },
            { msg: 'scene:create-nodes-by-uuids', args: [[FAKE], FAKE] },
            { msg: 'scene:create-node-by-prefab', args: [FAKE, FAKE] },
            { msg: 'scene:set-property', args: [{ id: FAKE, path: 'position.x', type: 'Float', value: 0, isSubProp: false }] },
            { msg: 'scene:new-property', args: [FAKE, 'foo', 0] },
            { msg: 'scene:reset-property', args: [FAKE, 'position'] },
            { msg: 'scene:move-nodes', args: [[FAKE], FAKE] },
            { msg: 'scene:delete-nodes', args: [[FAKE]] },
            { msg: 'scene:duplicate-nodes', args: [[FAKE]] },
            { msg: 'scene:create-prefab', args: [FAKE] },
        ];

        // Main-process sendToPanel + timeout race. 'not found'/'no handler' = closed;
        // err khac / result = exists; no reply in time = timeout (message co the la event 1-chieu).
        const probeOne = (msg: string, margs: any[]) => new Promise<any>((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) { settled = true; resolve({ msg, status: 'timeout', note: 'no reply — co the la event 1-chieu hoac handler khong reply' }); }
            }, timeoutMs);
            try {
                (Editor.Ipc.sendToPanel as any)('scene', msg, ...margs, (err: any, result: any) => {
                    if (settled) { return; }
                    settled = true;
                    clearTimeout(timer);
                    if (err) {
                        const m = err && err.message ? err.message : String(err);
                        const closed = /not found|not registered|no handler|does not exist/i.test(m);
                        resolve({ msg, status: closed ? 'closed' : 'exists', err: m });
                    } else {
                        let sample: string;
                        try { sample = result === undefined ? 'undefined' : JSON.stringify(result).slice(0, 200); }
                        catch { sample = '<unserializable>'; }
                        resolve({ msg, status: 'exists', sample, type: typeof result });
                    }
                });
            } catch (e: any) {
                if (!settled) { settled = true; clearTimeout(timer); resolve({ msg, status: 'closed', err: e && e.message ? e.message : String(e) }); }
            }
        });

        const results = await Promise.all(msgs.map((m) => probeOne(m.msg, m.args)));
        const summary = {
            exists: results.filter((r) => r.status === 'exists').map((r) => r.msg),
            closed: results.filter((r) => r.status === 'closed').map((r) => r.msg),
            timeout: results.filter((r) => r.status === 'timeout').map((r) => r.msg),
        };
        return { results, summary };
    }
}
