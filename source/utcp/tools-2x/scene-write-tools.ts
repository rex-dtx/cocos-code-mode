import { utcpTool } from '../decorators';
import { sceneScript } from '../utils/ipc-promise';

/**
 * Write tools — probe verified direct assign (x: 0→999 OK).
 * scene-script handlers: set-node-prop, set-comp-prop, create-node,
 * remove-node, add-component, remove-component.
 */
export class SceneWriteTools {

    @utcpTool(
        'nodeSetProperty',
        'Set a property on a node or component by path. Node example: path "x", "y", "active", "opacity". Component example: give compType "cc.Sprite" and path "spriteFrame". Returns before/after.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid' },
                path: { type: 'string', description: 'Property path, e.g. x, y, active, opacity, color' },
                value: { description: 'New value' },
                compType: { type: 'string', description: 'If set, set on component instead of node, e.g. cc.Sprite' },
            },
            required: ['uuid', 'path', 'value'],
        },
        { type: 'object', properties: { before: {}, after: {}, path: { type: 'string' } } },
        'POST', ['scene', 'node', 'set', 'property', 'write']
    )
    async nodeSetProperty(args: { uuid: string, path: string, value: any, compType?: string }): Promise<any> {
        if (args.compType) {
            return sceneScript<any>('set-comp-prop', args.uuid, args.compType, args.path, args.value);
        }
        return sceneScript<any>('set-node-prop', args.uuid, args.path, args.value);
    }

    @utcpTool(
        'nodeCreate',
        'Create a new node. If parentUuid is given, attach under that node, else under scene root. Returns new node uuid.',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name for the new node' },
                parentUuid: { type: 'string', description: 'Parent node uuid, omit for scene root' },
            },
            required: ['name'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, name: { type: 'string' }, parent: { type: 'string' } }, required: ['uuid'] },
        'POST', ['scene', 'node', 'create', 'add', 'new']
    )
    async nodeCreate(args: { name: string, parentUuid?: string }): Promise<any> {
        return sceneScript<any>('create-node', args.name, args.parentUuid || '');
    }

    @utcpTool(
        'nodeRemove',
        'Remove a node from the scene (removeFromParent).',
        {
            type: 'object',
            properties: { uuid: { type: 'string', description: 'Node uuid to remove' } },
            required: ['uuid'],
        },
        { type: 'object', properties: { removed: { type: 'string' } }, required: ['removed'] },
        'POST', ['scene', 'node', 'remove', 'delete', 'destroy']
    )
    async nodeRemove(args: { uuid: string }): Promise<any> {
        return sceneScript<any>('remove-node', args.uuid);
    }

    @utcpTool(
        'nodeComponentManage',
        'Add or remove a component on a node. For add, compType like "cc.Sprite", "cc.Label", "cc.Button".',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['add', 'remove'], description: 'add or remove' },
                nodeUuid: { type: 'string', description: 'Node uuid' },
                compType: { type: 'string', description: 'Component class name, e.g. cc.Sprite' },
            },
            required: ['operation', 'nodeUuid', 'compType'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, type: { type: 'string' }, removed: { type: 'string' } } },
        'POST', ['scene', 'component', 'add', 'remove']
    )
    async nodeComponentManage(args: { operation: string, nodeUuid: string, compType: string }): Promise<any> {
        if (args.operation === 'add') {
            return sceneScript<any>('add-component', args.nodeUuid, args.compType);
        }
        return sceneScript<any>('remove-component', args.nodeUuid, args.compType);
    }
}
