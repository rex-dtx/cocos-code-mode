import { utcpTool } from '../decorators';
import { sceneIpc, sceneScript } from '../utils/ipc-promise';
import { ToolError } from '../tool-error';

const DEFAULT_TREE_DEPTH = 6;
const DEFAULT_MAX_NODES = 400;
function requireUuid(args: { uuid?: string }, operation: string): string {
    if (!args.uuid) {
        throw new ToolError({
            code: 'MISSING_INPUTS',
            status: 400,
            message: `uuid is required for operation ${operation}`,
            details: { missingInputs: ['uuid'], operation },
            recovery: 'Pass uuid from findNodes or nodeQuery tree.',
        });
    }
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

const DEFAULT_FIND_LIMIT = 50;
const MAX_FIND_LIMIT = 200;

export interface FindNodeHit {
    uuid: string;
    name: string;
    path: string;
    reference: { id: string; type: string };
}

/** In-memory walk of scene:query-hierarchy. Filters hidden editor roots. */
export function findNodesInHierarchy(
    roots: any,
    opts: { name?: string; idSet?: Set<string> | null; maxResults: number }
): { nodes: FindNodeHit[]; total: number; truncated: boolean } {
    const nameNeedle = opts.name ? String(opts.name).toLowerCase() : null;
    const idSet = opts.idSet || null;
    const hits: FindNodeHit[] = [];
    let total = 0;
    const stack: Array<{ node: any; path: string }> = [];
    const list = Array.isArray(roots) ? roots : roots ? [roots] : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (!n || n.hidden === true) { continue; }
        stack.push({ node: n, path: n.name || '' });
    }
    while (stack.length) {
        const { node, path: curPath } = stack.pop()!;
        const nodeName: string = node.name || '';
        const uuid: string = node.id || node.uuid || '';
        const nameOk = !nameNeedle || nodeName.toLowerCase().includes(nameNeedle);
        const idOk = !idSet || (uuid && idSet.has(uuid));
        if (nameOk && idOk && uuid) {
            total++;
            if (hits.length < opts.maxResults) {
                hits.push({ uuid, name: nodeName, path: curPath, reference: { id: uuid, type: 'cc.Node' } });
            }
        }
        const children: any[] = Array.isArray(node.children) ? node.children : [];
        for (let i = children.length - 1; i >= 0; i--) {
            const ch = children[i];
            if (!ch) { continue; }
            const childPath = curPath ? `${curPath}/${ch.name || ''}` : (ch.name || '');
            stack.push({ node: ch, path: childPath });
        }
    }
    return { nodes: hits, total, truncated: total > opts.maxResults };
}

function nodeNotFound(uuidOrPath: string, kind: 'uuid' | 'path'): never {
    throw new ToolError({
        code: 'TARGET_NOT_FOUND',
        status: 404,
        message: kind === 'path' ? `Node not found at path: ${uuidOrPath}` : `Node not found: ${uuidOrPath}`,
        details: { [kind]: uuidOrPath },
        recovery: 'Call nodeQuery tree or findNodes to list nodes on the active scene, then retry with a current uuid.',
    });
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
                    nodeNotFound(args.uuid || '', 'uuid');
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
                if (info && info.missed) { nodeNotFound(args.uuid || '', 'uuid'); }
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
                if (node === null) { nodeNotFound(args.path || '', 'path'); }
                return { result: node };
            }
            case 'by_component':
                if (!args.componentName) { throw new Error('componentName is required for operation by_component'); }
                return { result: await sceneIpc<any>('scene:query-nodes-by-comp-name', args.componentName) };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'findNodes',
        'Find nodes by name and/or component type. Walks scene:query-hierarchy; substring match on name, exact match on component class via scene:query-nodes-by-comp-name.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Substring match on node name (case-insensitive).' },
                componentType: { type: 'string', description: 'Exact component class, e.g. cc.Sprite, cc.Label.' },
                maxResults: { type: 'number', description: 'Cap results (default 50, max 200).' },
            },
        },
        {
            type: 'object',
            properties: {
                nodes: { type: 'array', items: { type: 'object' } },
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
            required: ['nodes', 'total'],
        },
        'GET',
        ['scene', 'node', 'find', 'search', 'name', 'component', 'filter']
    )
    async findNodes(args: { name?: string, componentType?: string, maxResults?: number } = {}): Promise<{ nodes: FindNodeHit[]; total: number; truncated: boolean }> {
        if (!args.name && !args.componentType) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'findNodes requires at least one of name or componentType',
                recovery: 'Pass name (substring) and/or componentType (e.g. cc.Sprite).',
            });
        }
        const maxResults = Math.max(1, Math.min(Number(args.maxResults) || DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT));
        let idSet: Set<string> | null = null;
        if (args.componentType) {
            const raw = await sceneIpc<any>('scene:query-nodes-by-comp-name', args.componentType);
            const ids: string[] = Array.isArray(raw)
                ? raw.map((item: any) => typeof item === 'string' ? item : (item && (item.id || item.uuid))).filter(Boolean)
                : [];
            idSet = new Set(ids);
        }
        const raw = await sceneIpc<any>('scene:query-hierarchy');
        const hierarchy = Array.isArray(raw) ? (raw.length === 2 ? raw[1] : raw) : raw;
        if (!hierarchy) {
            throw new ToolError({
                code: 'SCENE_EMPTY',
                status: 404,
                message: 'Scene is empty or could not retrieve scene tree.',
                recovery: 'Open a scene with sceneOpen, then retry findNodes.',
            });
        }
        return findNodesInHierarchy(hierarchy, { name: args.name, idSet, maxResults });
    }

    @utcpTool(
        'findNodesByAsset',
        'Find nodes referencing a given asset uuid (reverse-reference / impact analysis). Walks live components in scene-script.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Asset uuid to search for' },
                maxResults: { type: 'number', description: 'Cap results (default 200)' },
            },
            required: ['uuid'],
        },
        {
            type: 'object',
            properties: {
                nodes: { type: 'array', items: { type: 'object' } },
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
            required: ['nodes', 'total'],
        },
        'GET',
        ['scene', 'node', 'asset', 'find', 'reference', 'used_by', 'impact']
    )
    async findNodesByAsset(args: { uuid: string, maxResults?: number }): Promise<{ nodes: any[], total: number, truncated: boolean }> {
        const maxResults = Math.max(1, Math.min(Number(args.maxResults) || 200, 1000));
        const res = await sceneScript<any>('find-by-asset', args.uuid, { maxResults });
        const nodes = (res && res.nodes) || [];
        return { nodes, total: nodes.length, truncated: !!(res && res.truncated) };
    }

    @utcpTool(
        'findNodesWithMissingAssets',
        'Find nodes with missing/broken asset references (null spriteFrame/font/clip/etc). QA health check.',
        {
            type: 'object',
            properties: {
                maxResults: { type: 'number', description: 'Cap results (default 200)' },
            },
        },
        {
            type: 'object',
            properties: {
                nodes: { type: 'array', items: { type: 'object' } },
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
            required: ['nodes', 'total', 'truncated'],
        },
        'GET',
        ['scene', 'node', 'missing', 'broken', 'asset', 'qa', 'health', 'integrity']
    )
    async findNodesWithMissingAssets(args: { maxResults?: number } = {}): Promise<{ nodes: any[], total: number, truncated: boolean }> {
        const maxResults = Math.max(1, Math.min(Number(args.maxResults) || 200, 1000));
        const res = await sceneScript<any>('find-missing-assets', { maxResults });
        if (!res || !Array.isArray(res.nodes)) {
            throw new ToolError({
                code: 'SCENE_EMPTY',
                status: 404,
                message: 'findNodesWithMissingAssets: no payload — is a scene open?',
                recovery: 'Open a scene with sceneOpen, then retry.',
            });
        }
        return { nodes: res.nodes, total: res.nodes.length, truncated: !!res.truncated };
    }

    @utcpTool(
        'sceneBatchGet',
        'Batch nodeQuery dump across 1-100 node uuids in one call.',
        {
            type: 'object',
            properties: {
                uuids: { type: 'array', items: { type: 'string' }, description: 'Node uuids to dump' },
                includeTypes: { type: 'boolean', description: 'Include class definitions block (off by default)' },
            },
            required: ['uuids'],
        },
        { type: 'object', properties: { results: { type: 'array' }, total: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['results', 'total'] },
        'POST',
        ['scene', 'batch', 'dump', 'node', 'get']
    )
    async sceneBatchGet(args: { uuids: string[], includeTypes?: boolean }): Promise<{ results: any[]; total: number; truncated: boolean }> {
        if (!Array.isArray(args.uuids) || args.uuids.length === 0) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'sceneBatchGet requires a non-empty uuids array',
                recovery: 'Pass uuids from findNodes or nodeQuery tree.',
            });
        }
        const cap = Math.min(args.uuids.length, 100);
        const sliced = args.uuids.slice(0, cap);
        const results: any[] = [];
        for (const uuid of sliced) {
            try {
                const one = await this.nodeQuery({ operation: 'dump', uuid, includeTypes: args.includeTypes });
                results.push({ uuid, ok: true, result: one.result });
            } catch (err: any) {
                results.push({ uuid, ok: false, error: err instanceof ToolError ? err.message : String(err && err.message || err) });
            }
        }
        return { results, total: args.uuids.length, truncated: args.uuids.length > cap };
    }
}
