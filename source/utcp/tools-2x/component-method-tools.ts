import { utcpTool } from '../decorators';
import { sceneIpc } from '../utils/ipc-promise';

/**
 * Chuyen doi ket qua cua `scene:query-node-functions` sang dang nhom theo component.
 * Shape da verify tren 2.4.15: record `{componentName: methodName[]}`.
 *
 * Port tu v3 (commit 9fc494b): giu defensive parse vi facade IPC khong co type,
 * shape co the thay doi hoac tra array of objects thay vi record. Chi lay ten method
 * bang string; bo function / undefined / null.
 *
 * Export de check-node-budget.js verify offline (ham thuan, khong phu thuoc runtime).
 */
export function normalizeComponentFunctions(raw: any): Array<{ name: string | null; methods: string[] }> {
    const toMethods = (value: any): string[] => {
        // Accept: string[] | {name|functionName: string}[] | {methods|functions: string[]}
        // | record keyed by method name. Thu tu fallback giong v3.
        const source = Array.isArray(value)
            ? value
            : ((value && value.methods) || (value && value.functions)
                || (value && typeof value === 'object' ? Object.keys(value) : []));
        return (Array.isArray(source) ? source : [])
            .map((item: any) => typeof item === 'string' ? item : (item && (item.name || item.functionName)))
            .filter((name: any): name is string => typeof name === 'string' && !!name);
    };

    const components: Array<{ name: string | null; methods: string[] }> = [];
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            const name = entry && typeof entry === 'object'
                ? (entry.name || entry.type || entry.className || null)
                : (typeof entry === 'string' ? entry : null);
            if (name !== null) { components.push({ name, methods: toMethods(entry) }); }
        }
    } else if (raw && typeof raw === 'object') {
        for (const name of Object.keys(raw)) {
            components.push({ name, methods: toMethods(raw[name]) });
        }
    }
    return components;
}

export class ComponentMethodTools {

    /**
     * Port tu v3 (commit 9fc494b). Cung ten tool, cung muc dich: discovery cho
     * callComponentMethod (vong 2). Khac v3 o 2 diem:
     *   - arg la `uuid` string (quy uoc 2.x), khong phai InstanceReference
     *   - output group theo component NAME (khong co uuid): message
     *     `scene:query-node-functions` tra record {componentName: methodName[]},
     *     khong biet component uuid. Khi can uuid, lay tu nodeQuery dump.__comps__.
     */
    @utcpTool(
        'listComponentMethods',
        'List the callable method names of every component on a node — the discovery step before invoking a component method (otherwise the method name must be guessed). Results are grouped per component class name. Ported from the 3.x tool of the same name; 2.x returns class names, not component uuids.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid — from sceneSnapshot / nodeQuery tree or dump' },
            },
            required: ['uuid'],
        },
        {
            type: 'object',
            properties: {
                components: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            methods: { type: 'array', items: { type: 'string' } },
                        },
                    },
                },
            },
            required: ['components'],
        },
        'GET', ['scene', 'node', 'component', 'method', 'function', 'list', 'discover', 'callable', 'invoke', 'script']
    )
    async listComponentMethods(args: { uuid: string }): Promise<{ components: Array<{ name: string | null; methods: string[] }> }> {
        if (!args.uuid) { throw new Error('uuid is required'); }
        const uuid = args.uuid;

        // v3 check ton tai truoc khi hoi functions. 2.x query-node tra STRING JSON,
        // value:null = khong tim thay (xem op 'dump'). Thong nhat voi quy uoc vong 1.1.
        const dumpRaw = await sceneIpc<any>('scene:query-node', uuid);
        if (typeof dumpRaw === 'string') {
            let parsed: any;
            try { parsed = JSON.parse(dumpRaw); } catch (_) { parsed = null; }
            if (parsed && parsed.value === null) { throw new Error(`Node not found: ${uuid}`); }
        }

        const raw = await sceneIpc<any>('scene:query-node-functions', uuid);
        if (!raw) { return { components: [] }; }
        return { components: normalizeComponentFunctions(raw) };
    }
}
