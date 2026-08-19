import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import { SuccessIndicatorSchema, ISuccessIndicator, InstanceReferenceSchema, IInstanceReference } from '../schemas';

export class ComponentTools {

    @utcpTool(
        'nodeGetAvailableComponentTypes',
        'Get list of globally available component types (class names) at the moment.',
        {
            type: 'object',
            properties: {
                includeInternal: { type: 'boolean', default: false, description: 'Whether to include internal engine components.' },
                filter: { type: 'string', description: 'Optional filter string to match component types or categories (case-insensitive substring match).' }
            },
            required: ['includeInternal']
        },
        { type: 'object', properties: { componentTypes: { type: 'array', items: { type: 'string' } } }, required: ['componentTypes'] }, "GET",  ['scene', 'node', 'component', 'types', 'inspection']
    )
    async nodeGetAvailableComponentTypes(args: { includeInternal: boolean, filter?: string }): Promise<{ componentTypes: string[] }> {
        const allComponents = await Editor.Message.request('scene', 'query-components');

        if (!Array.isArray(allComponents)) {
            throw new Error('Failed to retrieve component types');
        }

        const lowerFilter = args.filter ? args.filter.toLowerCase() : null;
        const filtered = allComponents.filter((comp: any) => {
            let matchesFilter = true;
            if (lowerFilter) {
                matchesFilter = comp.type && comp.type.toLowerCase().includes(lowerFilter);
            }
            if (!args.includeInternal) {
                matchesFilter = matchesFilter && comp.assetUuid && comp.assetUuid.length > 0;
            }
            return matchesFilter;
        });

        const names = filtered.map((comp: any) => comp.name).filter((name: any) => typeof name === 'string');

        return { componentTypes: names };
    }

    @utcpTool(
        'nodeComponentsGet',
        'Get components of specific type on a node. If componentType is not provided, returns all components on the node.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                componentType: { type: 'string' }
            },
            required: ['reference']
        },
        { type: 'object', properties: { references: { type: 'array', items: InstanceReferenceSchema } }, required: ['references'] }, "GET",  ['scene', 'node', 'component', 'get', 'inspection']
    )
    async nodeComponentsGet(args: { reference: IInstanceReference, componentType?: string }): Promise<{ references: IInstanceReference[] }> {
        const node = await Editor.Message.request('scene', 'query-node', args.reference.id);
        if (!node) {
            throw new Error(`Node ${args.reference.id} not found`);
        }

        const components = node.__comps__ || [];
        const foundComponents: IInstanceReference[] = [];
        for (const comp of components) {
            const value = comp.value as any;
            const compUuid = value?.uuid?.value ?? value?.uuid;
            // comp.type is absent on some dumps (notably user scripts); the dump's
            // own __type__/cid carries the class name in that case. Without this
            // the client gets type: undefined and cannot filter by class at all.
            const compType = comp.type
                ?? value?.__type__?.value ?? value?.__type__
                ?? comp.cid ?? value?.cid;

            if (!args.componentType || (compType && compType.includes(args.componentType))) {
                foundComponents.push({ id: compUuid, type: compType });
            }
        }

        if (foundComponents.length > 0) {
            return { references: foundComponents };
        }

        // A node with no components at all is a legitimate answer, not an error —
        // only an unmatched explicit filter is worth throwing over.
        if (!args.componentType) {
            return { references: [] };
        }

        throw new Error(`Components of type ${args.componentType} not found on node ${args.reference.id}`);
    }

    /** @deprecated use nodeComponentManage({ operation: 'remove', reference }) — not registered, kept for delegation */
    async nodeComponentRemove(args: { reference: IInstanceReference }): Promise<ISuccessIndicator> {
        try {
            const component = await Editor.Message.request('scene', 'query-component', args.reference.id);
            if (component === null || component === undefined) {
                throw new Error(`Component ${args.reference.id} not found`);
            }

            await Editor.Message.request('scene', 'remove-component', {
                uuid: args.reference.id
            });

            await Editor.Message.request('scene', 'snapshot');

            return { success: true };
        } catch (error: any) {
            throw new Error(`Failed to remove component ${args.reference.id}. Reason: ${error?.message || error}`);
        }
    }

    /** @deprecated use nodeComponentManage({ operation: 'add', reference, componentType }) — not registered, kept for delegation */
    async nodeComponentAdd(args: { reference: IInstanceReference, componentType: string }): Promise<{ reference: IInstanceReference }> {
        const node = await Editor.Message.request('scene', 'query-node', args.reference.id);
        if (!node) {
            throw new Error(`Node ${args.reference.id} not found`);
        }

        const beforeComponents = node.__comps__ ? node.__comps__.map((c: any) => c.value?.uuid?.value || c.value?.uuid || c.uuid) : [];
        const existingUuids = new Set(beforeComponents);

        await Editor.Message.request('scene', 'execute-scene-script',
            { name: packageJSON.name, method: 'startCatchLogging', args: [] });

        await Editor.Message.request('scene', 'create-component', {
            uuid: args.reference.id,
            component: args.componentType
        });

        const nodeAfter = await Editor.Message.request('scene', 'query-node', args.reference.id);
        const afterComponents: IInstanceReference[] = nodeAfter.__comps__ ?
            nodeAfter.__comps__.map((c: any) => { return { id: c.value?.uuid?.value, type: c.type } }) : [];

        const caughtLogs: string[] = await Editor.Message.request('scene', 'execute-scene-script',
            { name: packageJSON.name, method: 'stopCatchLogging', args: [] });

        const newComponentRef = afterComponents.find(ref => !existingUuids.has(ref.id));

        if (newComponentRef) {
            await Editor.Message.request('scene', 'snapshot');

            return { reference: { id: newComponentRef.id, type: newComponentRef.type } };
        }

        throw new Error("Failed to add component. Captured logs: " + caughtLogs.join('\n'));
    }
}
