import { utcpTool } from '../decorators';
import { sceneIpc } from '../utils/ipc-promise';

const DEFAULT_TREE_DEPTH = 6;

function requireUuid(args: { uuid?: string }, operation: string): string {
    if (!args.uuid) { throw new Error(`uuid is required for operation ${operation}`); }
    return args.uuid;
}

/**
 * Cat cay hierarchy theo depth. Shape thuc te tu scene:query-hierarchy —
 * xem docs/cocos-2x-api-notes.md §phase 5.
 */
function truncateHierarchy(node: any, maxDepth: number, depth: number = 0): any {
    if (!node || typeof node !== 'object') { return node; }
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    const out: any = { ...node, childrenCount: children.length };
    if (children.length === 0) {
        delete out.children;
        return out;
    }
    if (depth >= maxDepth) {
        delete out.children;
        out.truncated = true;
        return out;
    }
    out.children = children.map((c) => truncateHierarchy(c, maxDepth, depth + 1));
    return out;
}

export class SceneReadTools {

    @utcpTool(
        'nodeQuery',
        'Read the open scene: node hierarchy tree, a single node property dump, node info, callable node functions, or find nodes by component class name.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['tree', 'dump', 'info', 'functions', 'by_component'], description: 'Which query to run' },
                uuid: { type: 'string', description: 'Node uuid — required for dump / info / functions' },
                componentName: { type: 'string', description: 'Component class name for by_component, e.g. cc.Sprite' },
                maxDepth: { type: 'number', description: `Max hierarchy depth for tree, default ${DEFAULT_TREE_DEPTH}` },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                result: {},
                sceneId: { type: 'string' },
            },
            required: ['result'],
        },
        'GET', ['scene', 'node', 'hierarchy', 'tree', 'dump', 'inspect']
    )
    async nodeQuery(args: { operation: string, uuid?: string, componentName?: string, maxDepth?: number }): Promise<{ result: any, sceneId?: string }> {
        switch (args.operation) {
            case 'tree': {
                // callback nhan (err, sceneID, hierarchy) — sceneIpc tra array khi >1 gia tri.
                const raw = await sceneIpc<any>('scene:query-hierarchy');
                const [sceneId, hierarchy] = Array.isArray(raw) ? raw : [undefined, raw];
                const maxDepth = args.maxDepth || DEFAULT_TREE_DEPTH;
                const result = Array.isArray(hierarchy)
                    ? hierarchy.map((n) => truncateHierarchy(n, maxDepth))
                    : truncateHierarchy(hierarchy, maxDepth);
                return { result, sceneId };
            }
            case 'dump': {
                // scene:query-node tra STRING, khong phai object.
                const raw = await sceneIpc<any>('scene:query-node', requireUuid(args, 'dump'));
                if (typeof raw !== 'string') { return { result: raw }; }
                try {
                    return { result: JSON.parse(raw) };
                } catch (e) {
                    throw new Error(`Node dump is not valid JSON. First 200 chars: ${raw.slice(0, 200)}`);
                }
            }
            case 'info':
                // arg 2 la class name — docs dung 'cc.Node'.
                return { result: await sceneIpc<any>('scene:query-node-info', requireUuid(args, 'info'), 'cc.Node') };
            case 'functions':
                return { result: await sceneIpc<any>('scene:query-node-functions', requireUuid(args, 'functions')) };
            case 'by_component':
                if (!args.componentName) { throw new Error('componentName is required for operation by_component'); }
                return { result: await sceneIpc<any>('scene:query-nodes-by-comp-name', args.componentName) };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }
}
