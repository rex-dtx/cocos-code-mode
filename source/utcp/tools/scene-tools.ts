import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import { ISceneTreeItem, SceneTreeItemSchema, Base64ImageSchema, IBase64Image, InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';

export class SceneTools {

    @utcpTool(
        'sceneOpen',
        'Open a scene by uuid. Resolve path to uuid first via assetGetAtPath.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            },
            required: ['reference']
        },
        SuccessIndicatorSchema, "POST", ['scene', 'open', 'load', 'uuid', 'level']
    )
    async sceneOpen(args: { reference: IInstanceReference }): Promise<ISuccessIndicator> {
        if (!args.reference || !args.reference.id) {
            throw new Error('sceneOpen requires reference.id (scene uuid)');
        }
        await Editor.Message.request('scene', 'open-scene', args.reference.id);
        return { success: true };
    }

    @utcpTool(
        'sceneGetInfo',
        'Get info about the current scene: its bounds (canvas/scene size), whether it has unsaved changes (dirty), and which scene asset is currently open.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                bounds: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
                    required: ['x', 'y', 'width', 'height']
                },
                dirty: { type: 'boolean' },
                currentScene: {
                    type: 'object',
                    properties: { uuid: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' } }
                }
            },
            required: ['bounds', 'dirty']
        }, "GET", ['scene', 'info', 'bounds', 'size', 'dirty', 'unsaved', 'current']
    )
    async sceneGetInfo(): Promise<{ bounds: { x: number, y: number, width: number, height: number }, dirty: boolean, currentScene?: { uuid?: string, url?: string, name?: string } }> {
        const bounds = await Editor.Message.request('scene', 'query-scene-bounds');
        if (!bounds) {
            throw new Error('Failed to query scene bounds');
        }
        const dirty = await Editor.Message.request('scene', 'query-dirty');

        // query-current-scene result shape varies by version (uuid string or info object)
        let currentScene: { uuid?: string, url?: string, name?: string } | undefined;
        try {
            const current = await Editor.Message.request('scene', 'query-current-scene');
            if (typeof current === 'string' && current) {
                currentScene = { uuid: current };
            } else if (current && typeof current === 'object') {
                currentScene = current as any;
            }
        } catch (e) {
            // No scene open or message unavailable - bounds/dirty still valid
            currentScene = undefined;
        }

        return { bounds, dirty: !!dirty, currentScene };
    }

    @utcpTool(
        'findNodesByAsset',
        'Find nodes referencing a given asset uuid. Reverse-reference / impact analysis.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            },
            required: ['reference']
        },
        { type: 'object', properties: { references: { type: 'array', items: InstanceReferenceSchema } }, required: ['references'] }, "GET", ['scene', 'node', 'find', 'asset', 'reference', 'usage', 'impact']
    )
    async findNodesByAsset(args: { reference: IInstanceReference }): Promise<{ references: IInstanceReference[] }> {
        if (!args.reference || !args.reference.id) {
            throw new Error('findNodesByAsset requires reference.id (asset uuid)');
        }
        const nodeUuids = await Editor.Message.request('scene', 'query-nodes-by-asset-uuid', args.reference.id);
        if (!Array.isArray(nodeUuids)) {
            throw new Error(`Unexpected result querying nodes for asset ${args.reference.id}`);
        }
        return { references: nodeUuids.map((uuid: string) => ({ id: uuid, type: 'cc.Node' })) };
    }

    @utcpTool(
        'findNodesWithMissingAssets',
        'Find nodes with missing/broken asset references. QA/health check for scene integrity.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { references: { type: 'array', items: InstanceReferenceSchema } }, required: ['references'] }, "GET", ['scene', 'node', 'missing', 'broken', 'asset', 'qa', 'health', 'integrity']
    )
    async findNodesWithMissingAssets(): Promise<{ references: IInstanceReference[] }> {
        const result = await Editor.Message.request('scene', 'query-nodes-miss-assets');
        if (!result) {
            return { references: [] };
        }
        if (!Array.isArray(result)) {
            throw new Error('Unexpected result from query-nodes-miss-assets');
        }
        // Items may be uuid strings or objects with uuid/name depending on version
        return {
            references: result.map((item: any) => ({
                id: typeof item === 'string' ? item : (item.uuid || item.id),
                type: 'cc.Node'
            })).filter((ref: IInstanceReference) => !!ref.id)
        };
    }

    @utcpTool(
        'nodeReset',
        'Reset node or component properties to defaults. Operations: "node" (all nodes), "component" (single component).',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['node', 'component'] },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For node: node uuids to reset. For component: exactly one component uuid.' }
            },
            required: ['operation', 'references']
        },
        SuccessIndicatorSchema, "POST", ['scene', 'node', 'component', 'reset', 'default', 'revert']
    )
    async nodeReset(args: { operation: string, references: IInstanceReference[] }): Promise<ISuccessIndicator> {
        const uuids = (args.references || []).map((r: IInstanceReference) => r.id).filter((id: string) => !!id);
        if (uuids.length === 0) {
            throw new Error('nodeReset requires non-empty references');
        }

        if (args.operation === 'node') {
            const ok = await Editor.Message.request('scene', 'reset-node', { uuid: uuids.length === 1 ? uuids[0] : uuids });
            if (!ok) {
                throw new Error(`Failed to reset nodes ${uuids.join(', ')}`);
            }
        } else if (args.operation === 'component') {
            if (uuids.length !== 1) {
                throw new Error('nodeReset operation "component" requires exactly one component uuid');
            }
            await Editor.Message.request('scene', 'reset-component', { uuid: uuids[0] });
        } else {
            throw new Error(`Unknown reset operation: ${args.operation}`);
        }

        await Editor.Message.request('scene', 'snapshot');
        return { success: true };
    }

    @utcpTool(
        'callComponentMethod',
        'Call a method on a component by uuid. Args and return must be JSON-serializable. Get uuid via nodeComponentsGet.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                methodName: { type: 'string', description: 'Name of the method to call' },
                methodArgs: { type: 'array', items: {}, description: 'Arguments to pass to the method (JSON-serializable)' }
            },
            required: ['reference', 'methodName']
        },
        { type: 'object', properties: { result: {} } }, "POST", ['scene', 'component', 'call', 'execute', 'method', 'invoke', 'script']
    )
    async callComponentMethod(args: { reference: IInstanceReference, methodName: string, methodArgs?: any[] }): Promise<{ result: any }> {
        if (!args.reference || !args.reference.id) {
            throw new Error('callComponentMethod requires reference.id (component uuid)');
        }
        const result = await Editor.Message.request('scene', 'execute-component-method', {
            uuid: args.reference.id,
            name: args.methodName,
            args: args.methodArgs || []
        });
        // The method may mutate scene state; snapshot so undo covers it
        await Editor.Message.request('scene', 'snapshot');
        return { result: result === undefined ? null : result };
    }

    @utcpTool(
        'listComponentMethods',
        'List callable method names per component on a node. Use to discover methods before callComponentMethod.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            },
            required: ['reference']
        },
        {
            type: 'object',
            properties: {
                components: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            reference: InstanceReferenceSchema,
                            methods: { type: 'array', items: { type: 'string' } }
                        }
                    }
                }
            },
            required: ['components']
        }, "GET", ['scene', 'node', 'component', 'method', 'function', 'list', 'discover', 'callable', 'invoke', 'script']
    )
    async listComponentMethods(args: { reference: IInstanceReference }): Promise<{ components: Array<{ reference: IInstanceReference, methods: string[] }> }> {
        if (!args.reference || !args.reference.id) {
            throw new Error('listComponentMethods requires reference.id (node uuid)');
        }
        if (await Editor.Message.request('scene', 'query-node', args.reference.id) === null) {
            throw new Error(`Node ${args.reference.id} not found`);
        }

        const raw = await Editor.Message.request('scene', 'query-component-function-of-node', args.reference.id);
        if (!raw) {
            return { components: [] };
        }

        // Result is untyped (facade returns `any`). Observed shape is a record keyed by
        // component uuid whose value lists the method names, but tolerate an array of
        // {uuid, functions} entries and plain string lists too.
        const toMethods = (value: any): string[] => {
            const source = Array.isArray(value)
                ? value
                : (value?.functions || value?.methods || (value && typeof value === 'object' ? Object.keys(value) : []));
            return (Array.isArray(source) ? source : [])
                .map((item: any) => typeof item === 'string' ? item : (item?.name || item?.functionName))
                .filter((name: any): name is string => typeof name === 'string' && !!name);
        };

        const components: Array<{ reference: IInstanceReference, methods: string[] }> = [];
        if (Array.isArray(raw)) {
            for (const entry of raw) {
                const id = typeof entry === 'object' ? (entry?.uuid || entry?.id) : undefined;
                if (id) {
                    components.push({ reference: { id, type: entry?.type || entry?.cid }, methods: toMethods(entry) });
                }
            }
        } else if (typeof raw === 'object') {
            for (const [id, value] of Object.entries(raw)) {
                components.push({ reference: { id }, methods: toMethods(value) });
            }
        }

        return { components };
    }

    @utcpTool(
        'listComponentClasses',
        'List classes known to the editor, optionally filtered by base class (e.g. "cc.Component"). Helps resolve valid class names before nodeComponentAdd.',
        {
            type: 'object',
            properties: {
                extends: { type: 'string', description: 'Base class name to filter by, e.g. cc.Component' },
                excludeSelf: { type: 'boolean', description: 'Exclude the base class itself from results', default: false },
                filter: { type: 'string', description: 'Case-insensitive substring match on class name' }
            }
        },
        { type: 'object', properties: { classes: { type: 'array', items: { type: 'string' } } }, required: ['classes'] }, "GET", ['scene', 'class', 'component', 'list', 'types', 'script']
    )
    async listComponentClasses(args: { extends?: string, excludeSelf?: boolean, filter?: string }): Promise<{ classes: string[] }> {
        const options: { extends?: string, excludeSelf?: boolean } = {};
        if (args.extends) {
            options.extends = args.extends;
        }
        if (args.excludeSelf) {
            options.excludeSelf = true;
        }
        const classes = await Editor.Message.request('scene', 'query-classes', options);
        if (!Array.isArray(classes)) {
            throw new Error('Failed to query classes');
        }
        const lowerFilter = args.filter ? args.filter.toLowerCase() : null;
        const names = classes
            .map((c: any) => (c && c.name) as string)
            .filter((name: any) => typeof name === 'string' && (!lowerFilter || name.toLowerCase().includes(lowerFilter)));
        return { classes: names };
    }

    @utcpTool(
        'nodeClipboard',
        'Copy/cut/paste nodes via editor clipboard. Paste returns references of pasted nodes.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['copy', 'cut', 'paste'] },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For copy/cut: the nodes to copy/cut. For paste: the copied node references to paste.' },
                targetReference: InstanceReferenceSchema,
                keepWorldTransform: { type: 'boolean', description: 'For paste: keep world transform of pasted nodes', default: true },
                pasteAsChild: { type: 'boolean', description: 'For paste: paste as child of the target node', default: false }
            },
            required: ['operation', 'references']
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                references: { type: 'array', items: InstanceReferenceSchema }
            },
            required: ['success']
        }, "POST", ['scene', 'node', 'copy', 'cut', 'paste', 'clipboard']
    )
    async nodeClipboard(args: { operation: string, references: IInstanceReference[], targetReference?: IInstanceReference, keepWorldTransform?: boolean, pasteAsChild?: boolean }):
        Promise<{ success: boolean, references?: IInstanceReference[] }> {
        const uuids = (args.references || []).map((r: IInstanceReference) => r.id).filter((id: string) => !!id);
        if (uuids.length === 0) {
            throw new Error('nodeClipboard requires non-empty references');
        }

        switch (args.operation) {
            case 'copy': {
                const copied = await Editor.Message.request('scene', 'copy-node', uuids);
                if (!Array.isArray(copied)) {
                    throw new Error(`Copy failed for nodes ${uuids.join(', ')}`);
                }
                return { success: true, references: copied.map((id: string) => ({ id, type: 'cc.Node' })) };
            }
            case 'cut': {
                await Editor.Message.request('scene', 'cut-node', uuids);
                await Editor.Message.request('scene', 'snapshot');
                return { success: true, references: uuids.map((id: string) => ({ id, type: 'cc.Node' })) };
            }
            case 'paste': {
                if (!args.targetReference || !args.targetReference.id) {
                    throw new Error('targetReference required for paste');
                }
                const pasted = await Editor.Message.request('scene', 'paste-node', {
                    target: args.targetReference.id,
                    uuids: uuids,
                    keepWorldTransform: args.keepWorldTransform ?? true,
                    pasteAsChild: args.pasteAsChild ?? false
                });
                if (!Array.isArray(pasted) || pasted.length === 0) {
                    throw new Error('Paste returned no nodes');
                }
                await Editor.Message.request('scene', 'snapshot');
                return { success: true, references: pasted.map((id: string) => ({ id, type: 'cc.Node' })) };
            }
            default:
                throw new Error(`Unknown clipboard operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'nodeGetTree',
        'Get the hierarchy tree of specific node or scene root if no reference is provided. Children have recursive structure.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            }
        },
        SceneTreeItemSchema, "GET",  ['scene', 'graph', 'node', 'hierarchy', 'tree']
    )
    async nodeGetTree(args: { reference?: IInstanceReference }): Promise<ISceneTreeItem> {
        let treeBase;
        if (args.reference) {
             treeBase = await Editor.Message.request('scene', 'query-node-tree', args.reference.id);
        } else {
             // Default queries the whole scene
             treeBase = await Editor.Message.request('scene', 'query-node-tree');
             // In prefab-edit mode the editor wraps the prefab in a throwaway scene:
             // an unnamed virtual root ("New Node", which query-node cannot even
             // resolve) holding a locked Canvas, with the real prefab root beneath.
             // Returning that wrapper makes a correctly-serialized prefab look
             // renamed and empty. Descend to the root the user actually opened.
             treeBase = (await this.findPrefabEditRoot(treeBase)) ?? treeBase;
        }

        if (!treeBase) {
            throw new Error(`Node tree not found for ${args.reference?.id || 'entire scene'}`);
        }

        const formatNode = (node: any): ISceneTreeItem => {

           const comps = node.components ? node.components.map((c: any) => ({
               reference: { id: c.value, type: c.type }
           })) : [];

           let children: ISceneTreeItem[] = [];
            children = node.children ? node.children.map(formatNode).filter((c: any) => c !== null) : [];

           return {
                reference: { id: node.uuid, type: 'cc.Node' },
                name: node.name,
                active: node.active,
                components: comps,
                children: children
           };
        };
        
        const result: ISceneTreeItem = formatNode(treeBase);
        result.path = (treeBase as any).path || undefined;
        return result;
    }

    @utcpTool(
        'nodeGetAtPath',
        'Get nodes at specific path in the scene hierarchy. Usually returns one node, but can return multiple nodes with the same name.',
        {
            type: 'object',
            properties: {
                hierarchyPath: { type: 'string', description: 'Path to the node in the scene hierarchy"' },
            },
            required: ['hierarchyPath']
        }, { type: 'object', properties: { references: { type: 'array', items: InstanceReferenceSchema } } }, "GET",  ['scene', 'node', 'get', 'path', 'find', 'look', 'instance', 'hierarchy']
    )
    async nodeGetAtPath(args: { hierarchyPath: string }): Promise<{ references: IInstanceReference[] }> {
        const nodeTree = await Editor.Message.request('scene', 'query-node-tree');
        if (!nodeTree) {
            throw new Error(`Scene is empty or could not retrieve scene tree.`);
        }

        const sceneRootName = (nodeTree.name as unknown as string);
        if (args.hierarchyPath.startsWith('/')) {
            args.hierarchyPath = args.hierarchyPath.slice(1);
        }
        if (args.hierarchyPath.startsWith(`${sceneRootName}`)) {
            args.hierarchyPath = args.hierarchyPath.slice(sceneRootName.length);
        }
        if (args.hierarchyPath === '') {
            return { references: [{ id: (nodeTree.uuid as unknown as string) }] };
        }

        const pathParts = args.hierarchyPath.split('/').filter(p => p.length > 0);
        let currentNodes = [nodeTree];
        for (const part of pathParts) {
            const nextNodes: any[] = [];
            for (const node of currentNodes) {
                const matchingChildren = (node.children || []).filter((child: any) => child.name === part);
                nextNodes.push(...matchingChildren);
            }
            currentNodes = nextNodes;
            if (currentNodes.length === 0) {
                break;
            }
        }

        return { references: currentNodes.map((node: any) => ({ id: node.uuid, type: 'cc.Node' })) };
    }

    @utcpTool(
        'nodeCreatePrimitive',
        'Create a new node with predefined primitive geometry MeshRenderer. If no parent is specified, root node is used. Returns reference to the new node.',
         {  type: 'object',
            properties: {
                name: { type: 'string' },
                primitiveType: { type: 'string', enum: [
                    'Capsule', 'Cone', 'Cube', 'Cylinder', 'Plane', 'Quad', 'Sphere', 'Torus',
                ] },
                parentReference: InstanceReferenceSchema
            },
            required: ['name', 'primitiveType']
         }, 
         { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST",  ['scene', 'node', 'create', 'add']
    )
    async sceneCreatePrimitiveNode(args: { name: string, primitiveType: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference }> {
        const primitiveMap: Record<string, string> = {
            'Capsule': "db://internal/default_prefab/3d/Capsule.prefab",
            'Cone': "db://internal/default_prefab/3d/Cone.prefab",
            'Cube': "db://internal/default_prefab/3d/Cube.prefab",
            'Cylinder': "db://internal/default_prefab/3d/Cylinder.prefab",
            'Plane': "db://internal/default_prefab/3d/Plane.prefab",
            'Quad': "db://internal/default_prefab/3d/Quad.prefab",
            'Sphere': "db://internal/default_prefab/3d/Sphere.prefab",
            'Torus': "db://internal/default_prefab/3d/Torus.prefab",
        };

        if (!primitiveMap[args.primitiveType]) {
            throw new Error(`Unsupported primitive type: ${args.primitiveType}`);
        }

        const prefabUrl = primitiveMap[args.primitiveType];
        const assetUuid = await Editor.Message.request('asset-db', 'query-uuid', prefabUrl);
        if (!assetUuid) {
            throw new Error(`Failed to find asset for primitive type ${args.primitiveType} at ${prefabUrl}`);
        }
        return await this.sceneCreateNode({
            name: args.name,
            parentReference: args.parentReference,
            assetReference: { id: assetUuid, type: 'cc.Prefab' },
            unwrapPrefab: true
        });
    }

    @utcpTool(
        'nodeCreate',
        'Create a new node in the scene. If no parent is specified, root node is used. Returns reference to the new node.',
        {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parentReference: InstanceReferenceSchema,
                assetReference: InstanceReferenceSchema,
                unwrapPrefab: { type: 'boolean', default: false }
            },
            required: ['name']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST",  ['scene', 'node', 'create', 'add']
    )
    async sceneCreateNode(args: { name: string, parentReference?: IInstanceReference, assetReference?: IInstanceReference, unwrapPrefab?: boolean }): Promise<{ reference: IInstanceReference }> {
        const options: any = {
            name: args.name
        };
        if (args.parentReference) {
            options.parent = args.parentReference.id;
        } else {
            // Force root if no parent provided
            options.parent = (await Editor.Message.request('scene', 'query-node-tree')).uuid;
        }

        let assetUuid: string | null = null;

        // 1. Determine Asset UUID
        if ((args.assetReference && 'id' in args.assetReference)) {
            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.assetReference.id);
            if (!assetInfo) {
                throw new Error(`Asset reference not found: ${args.assetReference.id}`);
            }

            let prefabFound = assetInfo.type === 'cc.Prefab';
            // If not a prefab, check if it has a prefab sub-asset (like in case of FBX)
            if (!prefabFound) {
                for (let subAsset of Object.values(assetInfo.subAssets)) {
                    if (subAsset.type === 'cc.Prefab') {
                        assetUuid = subAsset.uuid;
                        prefabFound = true;
                        break;
                    }
                }
            } else {
                assetUuid = assetInfo.uuid;
            }

            if (!prefabFound) {
                throw new Error(`Provided asset reference ${args.assetReference.id} is not a prefab and does not contain a prefab sub-asset.`);
            } else {
                if (!args.unwrapPrefab) {
                    options.unlinkPrefab = false;
                    options.type = 'cc.Prefab';
                }
            }
        }

        if (assetUuid) {
            options.assetUuid = assetUuid;
        }

        // 2. Create Node
        const result = await Editor.Message.request('scene', 'create-node', options);
        const newNodeUuid = Array.isArray(result) ? result[0] : result;

        if (!newNodeUuid) {
            throw new Error(`Failed to create node ${args.name}${args.assetReference ? ` from asset ${args.assetReference.id}` : ''}.`);
        }

        await Editor.Message.request('scene', 'snapshot');

        return { reference: { id: newNodeUuid, type: 'cc.Node' } };
    }

    @utcpTool(
        'nodeOperate',
        'Node operations: hierarchy locking, prefab link/unlink/create/save. Lock prevents edit/select in scene view.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['move', 'copy', 'delete', 'lock', 'unlock', 'create_prefab', 'link_prefab', 'revert_prefab', 'apply_prefab', 'unwrap_prefab', 'unwrap_prefab_completely', 'open_prefab'] },
                reference: InstanceReferenceSchema,
                newParentReference: InstanceReferenceSchema,
                newPrefabPath: { type: 'string', description: 'For create_prefab: target db:// path', nullable: true },
                prefabAssetReference: InstanceReferenceSchema,
                siblingIndex: { type: 'integer', description: 'For move/copy: target index in parent children array', nullable: true },
                recursive: { type: 'boolean', description: 'For lock/unlock: also apply to all descendants', default: false }
            },
            required: ['operation', 'reference']
        },
        { type: 'object',
            properties: {
                success: { type: 'boolean' },
                createdPrefabAssetReference: InstanceReferenceSchema,
                updatedNodeReference: InstanceReferenceSchema,
                copiedNodeReference: InstanceReferenceSchema
            }
        }, "POST",  ['scene', 'node', 'remove', 'move', 'copy', 'delete', 'lock', 'unlock', 'prefab', 'apply', 'revert', 'unwrap', 'create', 'link', 'bind']
    )
    async nodeOperate(args: { operation: string, reference: IInstanceReference, newParentReference?: IInstanceReference, newPrefabPath?: string, prefabAssetReference?: IInstanceReference, siblingIndex?: number, recursive?: boolean }):
        Promise<{ success?: boolean, createdPrefabAssetReference?: IInstanceReference, updatedNodeReference?: IInstanceReference, copiedNodeReference?: IInstanceReference }> {
        if (await Editor.Message.request('scene', 'query-node', args.reference.id) === null) {
            throw new Error(`Target node ${args.reference.id} not found`);
        }

        switch (args.operation) {
            case 'move':
                if (!args.newParentReference) {
                    throw new Error("newParentReference required for move");
                }

                await Editor.Message.request('scene', 'set-parent', {
                    parent: args.newParentReference.id,
                    uuids: args.reference.id,
                    keepWorldTransform: true
                });

                if (args.siblingIndex !== undefined) {
                    await this.setSiblingIndex(args.reference.id, args.siblingIndex);
                }

                await Editor.Message.request('scene', 'snapshot');
                
                return { success: true };

            case 'copy':
                 const duplicateResult = await Editor.Message.request('scene', 'duplicate-node', [args.reference.id]);
                 if (!duplicateResult || duplicateResult.length === 0) {
                    throw new Error(`Node ${args.reference.id} duplication failed`);
                 }
                 
                 const newNodes = duplicateResult as string[];
                 const newNodeId = newNodes[0]; 
                 
                 if (args.newParentReference) {
                     await Editor.Message.request('scene', 'set-parent', {
                        parent: args.newParentReference.id,
                        uuids: newNodes,
                        keepWorldTransform: true
                     });
                 }

                 if (args.siblingIndex !== undefined) {
                     await this.setSiblingIndex(newNodeId, args.siblingIndex);
                 }

                 await Editor.Message.request('scene', 'snapshot');
                 
                 return { success: true, copiedNodeReference: { id: newNodeId, type: 'cc.Node' } };

            case 'delete':
                await Editor.Message.request('scene', 'remove-node', {
                    uuid: args.reference.id
                });

                const nodeCheck = await Editor.Message.request('scene', 'query-node', args.reference.id);
                if (nodeCheck !== null && nodeCheck !== undefined) {
                    throw new Error(`Node ${args.reference.id} still exists after removal`);
                }

                await Editor.Message.request('scene', 'snapshot');

                return { success: true };

            case 'lock':
            case 'unlock':
                await Editor.Message.request('scene', 'change-node-lock',
                    args.reference.id, args.operation === 'lock', !!args.recursive);
                await Editor.Message.request('scene', 'snapshot');
                return { success: true };

            case 'create_prefab':
                if (!args.newPrefabPath) {
                    throw new Error("newPrefabPath required for create_prefab");
                }
                const parentInfo = await this.getParentAndSiblingIndex(args.reference.id);

                const createdPrefabUuid = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: packageJSON.name,
                    method: 'createPrefabFromNode',
                    args: [args.reference.id, args.newPrefabPath]
                });
                
                if (!createdPrefabUuid) {
                    throw new Error("Failed to create prefab asset.");
                }
                const updatedNodeId = await this.getUpdatedUuid(parentInfo.parentUuid, parentInfo.siblingIndex);

                await Editor.Message.request('scene', 'snapshot');

                return { success: true, createdPrefabAssetReference: { id: createdPrefabUuid, type: 'cc.Prefab' }, updatedNodeReference: { id: updatedNodeId, type: 'cc.Node' } };

            case 'link_prefab': {
                if (!args.prefabAssetReference || !args.prefabAssetReference.id) {
                    throw new Error('prefabAssetReference required for link_prefab');
                }
                const prefabInfo = await Editor.Message.request('asset-db', 'query-asset-info', args.prefabAssetReference.id);
                if (!prefabInfo) {
                    throw new Error(`Prefab asset ${args.prefabAssetReference.id} not found`);
                }
                await Editor.Message.request('scene', 'link-prefab', args.reference.id, args.prefabAssetReference.id);
                await Editor.Message.request('scene', 'snapshot');
                return { success: true };
            }

            case 'revert_prefab':
                const revertSuccess = await Editor.Message.request('scene', 'restore-prefab', { uuid: args.reference.id });

                await Editor.Message.request('scene', 'snapshot');

                return { success: revertSuccess };

            case 'apply_prefab':
                const applyError = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: packageJSON.name,
                    method: 'applyPrefabByNode',
                    args: [args.reference.id]
                });

                if (applyError != null) {
                    throw new Error(`Failed to apply prefab: ${applyError}`);
                }

                await Editor.Message.request('scene', 'snapshot');

                return { success: true };

            case 'unwrap_prefab':
                const unwrapError = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: packageJSON.name,
                    method: 'unlinkPrefabByNode',
                    args: [args.reference.id, false]
                });
                
                if (unwrapError != null) {
                    throw new Error(`Failed to unwrap prefab: ${unwrapError}`);
                }

                await Editor.Message.request('scene', 'snapshot');

                return { success: true };

            case 'unwrap_prefab_completely':
                const unwrapAllError = await Editor.Message.request('scene', 'execute-scene-script', {
                    name: packageJSON.name,
                    method: 'unlinkPrefabByNode',
                    args: [args.reference.id, true]
                });
                
                if (unwrapAllError != null) {
                    throw new Error(`Failed to unwrap prefab completely: ${unwrapAllError}`);
                }

                await Editor.Message.request('scene', 'snapshot');

                return { success: true };

            case 'open_prefab':
                const nodeForPrefab: any = await Editor.Message.request('scene', 'query-node', args.reference.id);
                if (!nodeForPrefab) {
                    throw new Error(`Node ${args.reference.id} not found`);
                }
                 
                const pInfo = nodeForPrefab.__prefab__ || nodeForPrefab._prefab || (nodeForPrefab.value && (nodeForPrefab.value.__prefab__ || nodeForPrefab.value._prefab));
                const pValue = pInfo?.value || pInfo;
                const targetUuid = pValue?.assetUuid || pValue?.uuid;

                if (!targetUuid) {
                    throw new Error(`Node ${args.reference.id} is not linked to a prefab`);
                }

                try { 
                    await Editor.Message.request('asset-db', 'open-asset', targetUuid);
                } catch (error: any) {
                    throw new Error(`Failed to open prefab asset ${targetUuid}. Reason: ${error?.message || error}`);
                }

                return { success: true };

            default:
                throw new Error(`Unknown scene node operation: ${args.operation}`);
        }
    }

    // Helpers

    /**
     * When a prefab is open for editing, 'query-current-scene' reports the prefab
     * ASSET uuid rather than a scene uuid. Walk the wrapper hierarchy for the node
     * whose __prefab__ marks it as that asset's root and return its subtree.
     * Returns null in ordinary scene mode, or if no such root is found.
     */
    private async findPrefabEditRoot(sceneTree: any): Promise<any | null> {
        if (!sceneTree) return null;

        const current: any = await Editor.Message.request('scene', 'query-current-scene');
        const openUuid = typeof current === 'string' ? current : current?.uuid;
        if (!openUuid) return null;

        // A real scene's root IS the open asset — nothing to unwrap.
        if (sceneTree.uuid === openUuid) return null;

        const asset = await Editor.Message.request('asset-db', 'query-asset-info', openUuid);
        if (!asset || asset.type !== 'cc.Prefab') return null;

        // Breadth-first: the prefab root is the shallowest node claiming to be one.
        const queue: any[] = [sceneTree];
        while (queue.length) {
            const node = queue.shift();
            if (!node) continue;

            if (node.uuid && node.uuid !== sceneTree.uuid) {
                const dump: any = await Editor.Message.request('scene', 'query-node', node.uuid)
                    .catch(() => null);
                const prefab = dump?.__prefab__?.value ?? dump?.__prefab__;
                const assetUuid = prefab?.prefabStateInfo?.assetUuid ?? prefab?.uuid;
                if (prefab && assetUuid === openUuid && prefab.rootUuid === node.uuid) {
                    return node;
                }
            }

            for (const child of node.children ?? []) {
                queue.push(child);
            }
        }

        return null;
    }

    private async getParent(nodeUuid: string): Promise<string> {
        const node = await Editor.Message.request('scene', 'query-node', nodeUuid);
        if (node?.parent?.value?.uuid) return node.parent.value.uuid;
        if (node?.parent?.uuid) return node.parent.uuid;

        // No parent recorded — the node sits directly under the scene root, so the
        // scene itself is the parent. 'scene:query-uuid' was used here before and
        // exists in neither 3.7.3 nor 3.8.7, meaning this path always threw.
        // query-current-scene returns either a uuid string or a scene info object.
        const current = await Editor.Message.request('scene', 'query-current-scene');
        if (typeof current === 'string') return current;
        return (current as any)?.uuid ?? '';
    }

    // Helper to set sibling index
    private async setSiblingIndex(uuid: string, index: number) {
        // Get parent first
        const parentUuid = await this.getParent(uuid);
        if (!parentUuid) {
            throw new Error(`Node ${uuid} has no parent`);
        }

        // Get children of parent
        const parentNode = await Editor.Message.request('scene', 'query-node', parentUuid);
        const childrenArray = parentNode.children;
        if (!childrenArray || !Array.isArray(childrenArray)) {
            throw new Error(`Parent node ${parentUuid} has no children`);
        }

        const currentIndex = childrenArray.findIndex((child: any) => child.value.uuid === uuid);
        if (currentIndex === -1) {
            throw new Error(`Node ${uuid} not found in parent children`);
        }

        if (currentIndex === index) return true;

        // Calculate offset
        // We need to move the element at currentIndex to targetIndex.
        // The API move-array-element works with offset from current position.
        
        // Ensure index is within bounds [0, length-1]
        const targetIndex = Math.max(0, Math.min(index, childrenArray.length - 1));
        const offset = targetIndex - currentIndex;
        
        if (offset === 0) return true;

        return await Editor.Message.request('scene', 'move-array-element', {
            uuid: parentUuid,
            path: 'children',
            target: currentIndex,
            offset: offset,
        });
    }

    private async getParentAndSiblingIndex(uuid: string): Promise<{ parentUuid: string, siblingIndex: number }> {
        const parentUuid = await this.getParent(uuid);
        if (!parentUuid) {
            throw new Error(`Node ${uuid} has no parent`);
        }

        const parentNode = await Editor.Message.request('scene', 'query-node', parentUuid);
        const childrenArray = parentNode.children;
        if (!childrenArray || !Array.isArray(childrenArray)) {
            throw new Error(`Parent node ${parentUuid} has no children`);
        }
        const index = childrenArray.findIndex((child: any) => child.value.uuid === uuid);
        if (index === -1) {
            throw new Error(`Node ${uuid} not found in parent children`);
        }
        return { parentUuid, siblingIndex: index };
    }
    
    private async getUpdatedUuid(parentUuid: string, siblingIndex: number): Promise<string> {
        const parentNodeInfo = await Editor.Message.request('scene', 'query-node', parentUuid);
        if (!parentNodeInfo || !parentNodeInfo.children || !Array.isArray(parentNodeInfo.children) || !parentNodeInfo.children[siblingIndex]) {
            throw new Error(`Failed to retrieve updated node info after prefab creation.`);
        }
        return parentNodeInfo.children[siblingIndex].value.uuid;
    }
}