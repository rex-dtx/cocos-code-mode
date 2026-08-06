import { utcpTool } from '../decorators';
import { sceneIpc, sceneScript } from '../utils/ipc-promise';

const DEFAULT_SNAPSHOT_DEPTH = 6;

export class DeepReadTools {

    @utcpTool(
        'sceneSnapshot',
        'Start here to understand the open scene. Returns the whole node tree in one round trip: name, uuid, transform, size, anchor and the component list of every node, plus the project design resolution. Editor-only roots are filtered out so the tree matches the Hierarchy panel. Raise maxDepth for deeper trees; truncated nodes report childrenCount.',
        {
            type: 'object',
            properties: {
                maxDepth: { type: 'number', description: `Max tree depth, default ${DEFAULT_SNAPSHOT_DEPTH}` },
            },
        },
        {
            type: 'object',
            properties: {
                name: { type: 'string' },
                uuid: { type: 'string' },
                designResolution: { type: 'object' },
                maxDepth: { type: 'number' },
                children: { type: 'array', items: { type: 'object' } },
            },
        },
        'GET', ['scene', 'snapshot', 'hierarchy', 'tree', 'overview', 'node', 'component']
    )
    async sceneSnapshot(args: { maxDepth?: number }): Promise<any> {
        // Arg boc trong object: so o vi tri cuoi bi IPC 2.x nuot lam timeout — xem
        // docs/cocos-2x-api-notes.md §phase 6.
        return sceneScript<any>('scene-snapshot', { maxDepth: args.maxDepth || DEFAULT_SNAPSHOT_DEPTH });
    }

    @utcpTool(
        'componentQuery',
        'Inspect components in the open scene: read the properties of one component, list registered component class names, or find which nodes carry a component. Prefer find over by_name — it returns node paths, by_name returns bare uuids.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['props', 'classes', 'by_name', 'find'], description: 'Which query to run' },
                path: { type: 'string', description: 'Node path for props, e.g. Canvas/background' },
                componentType: { type: 'string', description: 'Component class name, e.g. cc.Sprite — for props / by_name / find' },
                filter: { type: 'string', description: 'Substring filter for classes' },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                result: {},
                total: { type: 'number' },
            },
            required: ['result'],
        },
        'GET', ['component', 'props', 'inspect', 'find', 'classes', 'scene']
    )
    async componentQuery(args: { operation: string, path?: string, componentType?: string, filter?: string }): Promise<{ result: any, total?: number }> {
        switch (args.operation) {
            case 'props': {
                if (!args.path) { throw new Error('path is required for operation props'); }
                if (!args.componentType) { throw new Error('componentType is required for operation props'); }
                return { result: await sceneScript<any>('component-props', args.path, args.componentType) };
            }
            case 'classes': {
                const names = await sceneScript<string[]>('list-component-classes', args.filter || '');
                return { result: names, total: names.length };
            }
            case 'by_name': {
                if (!args.componentType) { throw new Error('componentType is required for operation by_name'); }
                const uuids = await sceneIpc<string[]>('scene:query-nodes-by-comp-name', args.componentType);
                return { result: uuids, total: (uuids || []).length };
            }
            case 'find': {
                if (!args.componentType) { throw new Error('componentType is required for operation find'); }
                const nodes = await sceneScript<any[]>('find-by-component', args.componentType);
                return { result: nodes, total: (nodes || []).length };
            }
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }
}
