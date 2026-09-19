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
                filter: { type: 'string', description: 'Optional filter string to match component types or categories (case-insensitive substring match).' },
                limit: { type: 'number', minimum: 1, maximum: 1000, default: 200, description: 'Maximum component types to return.' }
            }
        },
        { type: 'object', properties: { componentTypes: { type: 'array', items: { type: 'string' } }, total: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['componentTypes', 'total', 'truncated'] }, "GET",  ['scene', 'node', 'component', 'types', 'inspection']
    )
    async nodeGetAvailableComponentTypes(args: { includeInternal?: boolean, filter?: string, limit?: number } = {}): Promise<{ componentTypes: string[], total: number, truncated: boolean }> {
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
        const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);

        return { componentTypes: names.slice(0, limit), total: names.length, truncated: names.length > limit };
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
                if (!compUuid) {
                    throw new Error(`nodeComponentsGet: matched component on ${args.reference.id} carries no uuid — dump shape drift`);
                }
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

    async nodeComponentRemove(args: { reference: IInstanceReference }): Promise<ISuccessIndicator> {
        if (!args.reference?.id) throw new Error('nodeComponentRemove requires reference.id');
        try {
            const component = await Editor.Message.request('scene', 'query-component', args.reference.id);
            if (component === null || component === undefined) {
                throw new Error(`Component ${args.reference.id} not found`);
            }

            await Editor.Message.request('scene', 'remove-component', { uuid: args.reference.id });
            const remaining = await Editor.Message.request('scene', 'query-component', args.reference.id);
            if (remaining !== null && remaining !== undefined) {
                throw new Error(`Component ${args.reference.id} still exists after removal`);
            }
            await Editor.Message.request('scene', 'snapshot');
            return { success: true };
        } catch (error: unknown) {
            throw new Error(`Failed to remove component ${args.reference.id}. Reason: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async nodeComponentAdd(args: { reference: IInstanceReference, componentType: string }): Promise<{ reference: IInstanceReference }> {
        if (!args.reference?.id || !args.componentType) throw new Error('nodeComponentAdd requires reference.id and componentType');
        const node = await Editor.Message.request('scene', 'query-node', args.reference.id);
        if (!node) throw new Error(`Node ${args.reference.id} not found`);

        const componentUuid = (component: unknown): string | undefined => {
            if (!component || typeof component !== 'object') return undefined;
            const row = component as Record<string, unknown>;
            const value = row.value && typeof row.value === 'object' ? row.value as Record<string, unknown> : undefined;
            const uuid = value?.uuid;
            if (typeof uuid === 'string') return uuid;
            if (uuid && typeof uuid === 'object' && typeof (uuid as Record<string, unknown>).value === 'string') return (uuid as Record<string, unknown>).value as string;
            return typeof row.uuid === 'string' ? row.uuid : undefined;
        };
        const componentType = (component: unknown): string | undefined => {
            if (!component || typeof component !== 'object') return undefined;
            const row = component as Record<string, unknown>;
            if (typeof row.type === 'string') return row.type;
            const value = row.value && typeof row.value === 'object' ? row.value as Record<string, unknown> : undefined;
            const declared = value?.__type__;
            if (typeof declared === 'string') return declared;
            if (declared && typeof declared === 'object' && typeof (declared as Record<string, unknown>).value === 'string') return (declared as Record<string, unknown>).value as string;
            return typeof row.cid === 'string' ? row.cid : typeof value?.cid === 'string' ? value.cid : undefined;
        };
        const existingUuids = new Set<string>((node.__comps__ ?? []).map(componentUuid).filter((id: string | undefined): id is string => !!id));

        await Editor.Message.request('scene', 'execute-scene-script', { name: packageJSON.name, method: 'startCatchLogging', args: [] });
        let caughtLogs: string[] = [];
        try {
            await Editor.Message.request('scene', 'create-component', { uuid: args.reference.id, component: args.componentType });
            caughtLogs = await Editor.Message.request('scene', 'execute-scene-script', { name: packageJSON.name, method: 'stopCatchLogging', args: [] }) ?? [];
        } catch (error) {
            await Editor.Message.request('scene', 'execute-scene-script', { name: packageJSON.name, method: 'stopCatchLogging', args: [] }).catch(() => undefined);
            throw error;
        }

        const nodeAfter = await Editor.Message.request('scene', 'query-node', args.reference.id);
        if (!nodeAfter) throw new Error(`nodeComponentAdd: node ${args.reference.id} disappeared after create-component`);
        const newComponent = (nodeAfter.__comps__ ?? []).find((component: unknown) => {
            const id = componentUuid(component);
            return !!id && !existingUuids.has(id) && componentType(component) === args.componentType;
        });
        const newId = componentUuid(newComponent);
        if (!newId) throw new Error(`Failed to add component. Captured logs: ${caughtLogs.join('\n')}`);

        await Editor.Message.request('scene', 'snapshot');
        const verifiedNode = await Editor.Message.request('scene', 'query-node', args.reference.id);
        const verified = (verifiedNode?.__comps__ ?? []).find((component: unknown) => componentUuid(component) === newId);
        if (!verified) throw new Error(`Component ${newId} was not present after add read-back`);
        return { reference: { id: newId, type: componentType(verified) ?? args.componentType } };
    }
}
