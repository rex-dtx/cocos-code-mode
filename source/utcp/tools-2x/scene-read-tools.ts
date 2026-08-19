import { utcpTool } from '../decorators';
import { sceneIpc, sceneScript } from '../utils/ipc-promise';

const DEFAULT_TREE_DEPTH = 6;
const DEFAULT_MAX_NODES = 400;

function requireUuid(args: { uuid?: string }, operation: string): string {
    if (!args.uuid) { throw new Error(`uuid is required for operation ${operation}`); }
    return args.uuid;
}

/**
 * Cat cay hierarchy theo depth VA so node. Shape thuc te tu scene:query-hierarchy —
 * xem docs/cocos-2x-api-notes.md §phase 5.
 *
 * Cung quy uoc voi nodeBrief trong scene-script.ts: `truncated` la LY DO
 * ('maxDepth' | 'nodeLimit'), `childrenOmitted` dem con bi bo. Depth mot minh khong
 * chan duoc cay rong (1 root, 2000 con cung cap).
 */
// Export de scripts/check-node-budget.js verify duoc logic cat cay (2 nhanh doc lap,
// khong test thi de vo tinh pha).
export function truncateHierarchy(node: any, maxDepth: number, budget: { left: number }, depth: number = 0): any {
    if (!node || typeof node !== 'object') { return node; }
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    const out: any = { ...node, childrenCount: children.length };
    if (children.length === 0) {
        delete out.children;
        return out;
    }
    if (depth >= maxDepth) {
        delete out.children;
        out.truncated = 'maxDepth';
        return out;
    }
    out.children = [];
    for (let i = 0; i < children.length; i++) {
        if (budget.left <= 0) {
            out.truncated = 'nodeLimit';
            out.childrenOmitted = children.length - i;
            if (out.children.length === 0) { delete out.children; }
            break;
        }
        budget.left--;
        out.children.push(truncateHierarchy(children[i], maxDepth, budget, depth + 1));
    }
    return out;
}

export class SceneReadTools {

    @utcpTool(
        'nodeQuery',
        'Query scene nodes: tree, dump, info, functions, by_component, or at_path. Supports maxDepth/maxNodes.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['tree', 'dump', 'info', 'functions', 'by_component', 'at_path'], description: 'Which query to run' },
                uuid: { type: 'string', description: 'Node uuid — required for dump / info / functions' },
                path: { type: 'string', description: 'Node path for at_path, e.g. Canvas/background' },
                componentName: { type: 'string', description: 'Component class name for by_component, e.g. cc.Sprite' },
                maxDepth: { type: 'number', description: `Max depth — hierarchy tree default ${DEFAULT_TREE_DEPTH}, at_path default 3` },
                maxNodes: { type: 'number', description: `Max nodes to walk for tree / at_path, default ${DEFAULT_MAX_NODES}. Guards wide scenes that maxDepth alone does not bound.` },
                includeTypes: { type: 'boolean', description: 'dump only: include the class definitions block. Off by default — it is roughly 90% of the payload and is rarely needed to read values.' },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                result: {},
                sceneId: { type: 'string' },
                maxNodes: { type: 'number' },
                nodesVisited: { type: 'number' },
                budgetExhausted: { type: 'boolean' },
            },
            required: ['result'],
        },
        'GET', ['scene', 'node', 'hierarchy', 'tree', 'dump', 'inspect']
    )
    async nodeQuery(args: { operation: string, uuid?: string, path?: string, componentName?: string, maxDepth?: number, maxNodes?: number, includeTypes?: boolean }): Promise<{ result: any, sceneId?: string, maxNodes?: number, nodesVisited?: number, budgetExhausted?: boolean }> {
        switch (args.operation) {
            case 'tree': {
                // callback nhan (err, sceneID, hierarchy) — sceneIpc tra array khi >1 gia tri.
                const raw = await sceneIpc<any>('scene:query-hierarchy');
                const [sceneId, hierarchy] = Array.isArray(raw) ? raw : [undefined, raw];
                const maxDepth = args.maxDepth || DEFAULT_TREE_DEPTH;
                const maxNodes = args.maxNodes || DEFAULT_MAX_NODES;
                const budget = { left: maxNodes };
                const result = Array.isArray(hierarchy)
                    ? hierarchy.map((n) => { budget.left--; return truncateHierarchy(n, maxDepth, budget); })
                    : truncateHierarchy(hierarchy, maxDepth, budget);
                return {
                    result,
                    sceneId,
                    maxNodes,
                    nodesVisited: maxNodes - budget.left,
                    budgetExhausted: budget.left <= 0,
                };
            }
            case 'dump': {
                // scene:query-node tra STRING, khong phai object.
                const raw = await sceneIpc<any>('scene:query-node', requireUuid(args, 'dump'));
                if (typeof raw !== 'string') { return { result: raw }; }
                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    throw new Error(`Node dump is not valid JSON. First 200 chars: ${raw.slice(0, 200)}`);
                }
                // uuid sai -> {"types":{},"value":null}, KHONG throw (phase 5). Bien thanh
                // Error de dong bo voi at_path/props, agent khong phai tu check null.
                if (parsed && parsed.value === null) {
                    throw new Error(`Node not found: ${args.uuid}`);
                }
                // `types` la ~90% payload (19 KB cho 1 node Canvas, 12 class def) va chi la
                // schema — doc gia tri khong can. Bo mac dinh; agent xin lai bang includeTypes.
                if (!args.includeTypes && parsed && typeof parsed === 'object' && parsed.types) {
                    const typeNames = Object.keys(parsed.types);
                    delete parsed.types;
                    parsed.typesOmitted = typeNames;
                }
                return { result: parsed };
            }
            case 'info': {
                // arg 2 la class name — docs dung 'cc.Node'.
                const info = await sceneIpc<any>('scene:query-node-info', requireUuid(args, 'info'), 'cc.Node');
                // `missed` la co node-khong-ton-tai (phase 5), khong phai error. Thong nhat voi dump.
                if (info && info.missed) { throw new Error(`Node not found: ${args.uuid}`); }
                return { result: info };
            }
            case 'functions':
                return { result: await sceneIpc<any>('scene:query-node-functions', requireUuid(args, 'functions')) };
            case 'at_path': {
                // Nguon khac 4 op tren: scene-script (cc.find), khong phai scene panel IPC.
                if (!args.path) { throw new Error('path is required for operation at_path'); }
                const node = await sceneScript<any>('node-at-path', {
                    path: args.path,
                    maxDepth: args.maxDepth || 3,
                    maxNodes: args.maxNodes || 400,
                });
                // cc.find tra null khi khong thay — thong nhat voi dump/info.
                if (node === null) { throw new Error(`Node not found at path: ${args.path}`); }
                return { result: node };
            }
            case 'by_component':
                if (!args.componentName) { throw new Error('componentName is required for operation by_component'); }
                return { result: await sceneIpc<any>('scene:query-nodes-by-comp-name', args.componentName) };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }
}
