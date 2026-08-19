import { utcpTool } from '../decorators';
import { sceneIpc, sceneScript } from '../utils/ipc-promise';

const DEFAULT_SNAPSHOT_DEPTH = 6;
const DEFAULT_MAX_NODES = 400;
const DEFAULT_MAX_RESULTS = 200;

export class DeepReadTools {

    @utcpTool(
        'sceneSnapshot',
        'Get scene hierarchy tree with transforms, sizes, components. Supports maxDepth/maxNodes; marks truncated.',
        {
            type: 'object',
            properties: {
                maxDepth: { type: 'number', description: `Max tree depth, default ${DEFAULT_SNAPSHOT_DEPTH}` },
                maxNodes: { type: 'number', description: `Max nodes to walk, default ${DEFAULT_MAX_NODES}. Guards against wide scenes that maxDepth alone does not bound.` },
            },
        },
        {
            type: 'object',
            properties: {
                name: { type: 'string' },
                uuid: { type: 'string' },
                designResolution: { type: 'object' },
                maxDepth: { type: 'number' },
                maxNodes: { type: 'number' },
                nodesVisited: { type: 'number' },
                budgetExhausted: { type: 'boolean' },
                children: { type: 'array', items: { type: 'object' } },
            },
        },
        'GET', ['scene', 'snapshot', 'hierarchy', 'tree', 'overview', 'node', 'component']
    )
    async sceneSnapshot(args: { maxDepth?: number, maxNodes?: number }): Promise<any> {
        // Arg boc trong object: so o vi tri cuoi bi IPC 2.x nuot lam timeout — xem
        // docs/cocos-2x-api-notes.md §phase 6.
        return sceneScript<any>('scene-snapshot', {
            maxDepth: args.maxDepth || DEFAULT_SNAPSHOT_DEPTH,
            maxNodes: args.maxNodes || DEFAULT_MAX_NODES,
        });
    }

    @utcpTool(
        'componentQuery',
        'Inspect components: read one component props, list classes, or find nodes by component. Supports maxResults.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['props', 'classes', 'by_name', 'find'], description: 'Which query to run' },
                path: { type: 'string', description: 'Node path for props, e.g. Canvas/background' },
                componentType: { type: 'string', description: 'Component class name, e.g. cc.Sprite — for props / by_name / find' },
                filter: { type: 'string', description: 'Substring filter for classes' },
                maxResults: { type: 'number', description: `Cap on returned entries for find / classes, default ${DEFAULT_MAX_RESULTS}` },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                result: {},
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
            required: ['result'],
        },
        'GET', ['component', 'props', 'inspect', 'find', 'classes', 'scene']
    )
    async componentQuery(args: { operation: string, path?: string, componentType?: string, filter?: string, maxResults?: number }): Promise<{ result: any, total?: number, truncated?: boolean }> {
        switch (args.operation) {
            case 'props': {
                if (!args.path) { throw new Error('path is required for operation props'); }
                if (!args.componentType) { throw new Error('componentType is required for operation props'); }
                return { result: await sceneScript<any>('component-props', args.path, args.componentType) };
            }
            case 'classes': {
                const names = await sceneScript<string[]>('list-component-classes', args.filter || '');
                const cap = args.maxResults || DEFAULT_MAX_RESULTS;
                // Registry co ~800+ class; tra het lam ngop context. Cat + noi ro total that
                // de agent biet can loc hep hon bang `filter`.
                if (names.length > cap) {
                    return { result: names.slice(0, cap), total: names.length, truncated: true };
                }
                return { result: names, total: names.length };
            }
            case 'by_name': {
                if (!args.componentType) { throw new Error('componentType is required for operation by_name'); }
                const uuids = await sceneIpc<string[]>('scene:query-nodes-by-comp-name', args.componentType);
                return { result: uuids, total: (uuids || []).length };
            }
            case 'find': {
                if (!args.componentType) { throw new Error('componentType is required for operation find'); }
                const res = await sceneScript<any>('find-by-component', args.componentType, {
                    maxResults: args.maxResults || DEFAULT_MAX_RESULTS,
                });
                const nodes = (res && res.nodes) || [];
                return { result: nodes, total: nodes.length, truncated: !!(res && res.truncated) };
            }
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }
}
