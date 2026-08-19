import { utcpTool } from '../decorators';
import { panelIpc, sceneScript } from '../utils/ipc-promise';

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

    @utcpTool(
        'nodeMove',
        'Reparent a node under a new parent (or scene root if parentUuid omitted). Optionally set sibling index.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid to move' },
                parentUuid: { type: 'string', description: 'New parent uuid, omit for scene root' },
                siblingIndex: { type: 'number', description: 'Position among siblings, omit for append' },
            },
            required: ['uuid'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, parent: { type: 'string' } } },
        'POST', ['scene', 'node', 'move', 'reparent', 'parent']
    )
    async nodeMove(args: { uuid: string, parentUuid?: string, siblingIndex?: number }): Promise<any> {
        return sceneScript<any>('move-node', args.uuid, args.parentUuid || '', args.siblingIndex);
    }

    @utcpTool(
        'nodeDuplicate',
        'Duplicate a node (cc.instantiate). Clone is added as sibling under same parent.',
        {
            type: 'object',
            properties: { uuid: { type: 'string', description: 'Node uuid to duplicate' } },
            required: ['uuid'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, name: { type: 'string' }, parent: { type: 'string' } } },
        'POST', ['scene', 'node', 'duplicate', 'copy', 'clone', 'instantiate']
    )
    async nodeDuplicate(args: { uuid: string }): Promise<any> {
        return sceneScript<any>('duplicate-node', args.uuid);
    }

    @utcpTool(
        'nodeCreatePrimitive',
        'Create a primitive 3D node (Cube, Sphere, Capsule etc.) via cc.Model + mesh. Parent by uuid, else scene root.',
        {
            type: 'object',
            properties: {
                primitiveType: { type: 'string', enum: ['Cube','Sphere','Capsule','Cylinder','Plane','Quad','Cone','Torus'], description: 'Primitive type' },
                name: { type: 'string', description: 'Node name; defaults to primitive type' },
                parentUuid: { type: 'string', description: 'Parent node uuid' },
            },
            required: ['primitiveType'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, name: { type: 'string' } }, required: ['uuid'] },
        'POST', ['scene', 'node', 'primitive', 'cube', 'sphere', 'create']
    )
    async nodeCreatePrimitive(args: { primitiveType: string, name?: string, parentUuid?: string }): Promise<any> {
        return sceneScript<any>('create-primitive', args.primitiveType, args.name || args.primitiveType, args.parentUuid || '');
    }


    @utcpTool(
        'callComponentMethod',
        'Call a component method on a node by uuid. Discovery via listComponentMethods first.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Node uuid' },
                method: { type: 'string', description: 'Method name' },
                args: { type: 'array', items: {}, description: 'Optional args array' },
            },
            required: ['uuid','method'],
        },
        { type: 'object', properties: { result: {} } },
        'POST', ['scene','component','method','call','invoke']
    )
    async callComponentMethod(args: { uuid: string, method: string, args?: any[] }): Promise<any> {
        return sceneScript<any>('call-component-method', args.uuid, args.method, args.args || []);
    }

    @utcpTool(
        'nodeReset',
        'Reset node transform via resetPropertyByPath (undo-aware).',
        {
            type: 'object',
            properties: { uuid: { type: 'string', description: 'Node uuid' } },
            required: ['uuid'],
        },
        { type: 'object', properties: { uuid: { type: 'string' }, reset: { type: 'boolean' } } },
        'POST', ['scene','node','reset','property']
    )
    async nodeReset(args: { uuid: string }): Promise<any> {
        return sceneScript<any>('node-reset', args.uuid);
    }

    @utcpTool(
        'editorUndo',
        'Undo or redo the last scene operation. Uses Editor.Ipc scene panel messages.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['undo', 'redo'], description: 'undo or redo' },
            },
            required: ['operation'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } } },
        'POST', ['editor', 'undo', 'redo', 'history']
    )
    async editorUndo(args: { operation: string }): Promise<any> {
        const msg = args.operation === 'redo' ? 'scene:redo' : 'scene:undo';
        // try scene panel first, fallback to global
        const candidates: Array<[string, string]> = [
            ['scene', msg],
            ['scene', args.operation],
            ['editor', args.operation],
        ];
        let lastErr: any;
        for (const [panel, message] of candidates) {
            try {
                await panelIpc<any>(panel, message);
                return { success: true };
            } catch (e) { lastErr = e; }
        }
        throw new Error(`Undo failed: ${lastErr?.message || lastErr}`);
    }
}
