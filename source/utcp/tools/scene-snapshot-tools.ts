import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, SceneTreeItemSchema } from '../schemas';

// sceneSnapshot — unbounded scene dump for diff / full-state hand-off.
// Reuses query-node-tree but with generous defaults (depth 99, nodes 5000) so the
// caller gets the whole scene unless they cap it explicitly. Richer than
// nodeGetTree's default budgets (4/200) — use nodeGetTree for navigational queries.

export class SceneSnapshotTools {

    @utcpTool(
        'sceneSnapshot',
        'Full scene dump — unbounded hierarchy walk for diffing or handing the whole scene state to an agent. Defaults maxDepth=99/maxNodes=5000; pass smaller values to cap. Supports fields filter.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                maxDepth: { type: 'number', description: 'Max recursion depth (default 99 = whole tree)' },
                maxNodes: { type: 'number', description: 'Max nodes to walk (default 5000)' },
                fields: { type: 'array', items: { type: 'string' }, description: 'Optional field whitelist per node (e.g. ["name","active","uuid"]). Omit for all fields.' },
            },
        },
        {
            type: 'object',
            properties: {
                tree: SceneTreeItemSchema,
                nodeCount: { type: 'number' },
                truncated: { type: 'string' },
            },
            required: ['tree'],
        },
        'GET',
        ['scene', 'snapshot', 'dump', 'hierarchy', 'diff', 'full']
    )
    async sceneSnapshot(args: { reference?: IInstanceReference, maxDepth?: number, maxNodes?: number, fields?: string[] }): Promise<{ tree: any, nodeCount: number, truncated?: string }> {
        let treeBase: any;
        if (args.reference?.id) {
            treeBase = await Editor.Message.request('scene', 'query-node-tree', args.reference.id);
        } else {
            treeBase = await Editor.Message.request('scene', 'query-node-tree');
        }
        if (!treeBase) throw new Error(`Scene snapshot: node tree not found for ${args.reference?.id || 'scene root'}`);

        const maxDepth = args.maxDepth ?? 99;
        const maxNodes = args.maxNodes ?? 5000;
        const budget = { left: maxNodes };
        const fieldSet = args.fields?.length ? new Set(args.fields) : null;
        const want = (k: string) => !fieldSet || fieldSet.has(k);

        let truncated: string | undefined;

        const formatNode = (node: any, depth: number): any => {
            const atMaxDepth = depth >= maxDepth;
            let children: any[] = [];
            let childrenOmitted: number | undefined;
            let childrenCount: number | undefined;

            if (!atMaxDepth) {
                const rawChildren: any[] = node.children || [];
                if (rawChildren.length) {
                    childrenCount = rawChildren.length;
                    for (let i = 0; i < rawChildren.length; i++) {
                        if (budget.left <= 0) { truncated = 'nodeLimit'; childrenOmitted = rawChildren.length - i; break; }
                        budget.left--;
                        children.push(formatNode(rawChildren[i], depth + 1));
                    }
                }
            } else if (node.children?.length) {
                truncated = 'maxDepth';
                childrenOmitted = node.children.length;
                childrenCount = node.children.length;
            }

            const item: any = { reference: { id: node.uuid, type: 'cc.Node' }, children };
            if (want('name')) item.name = node.name;
            if (want('active')) item.active = node.active;
            if (want('uuid')) item.uuid = node.uuid;
            if (want('path') && node.path) item.path = node.path;
            if (want('components') || !fieldSet) {
                item.components = (node.components || []).map((c: any) => ({ reference: { id: c.value, type: c.type } }));
            }
            // Preserve extra dump keys when no field filter (full dump semantics)
            if (!fieldSet) {
                for (const k of Object.keys(node)) {
                    if (k === 'children' || k === 'components' || k in item) continue;
                    item[k] = node[k];
                }
            }
            if (truncated && childrenOmitted !== undefined) item.childrenOmitted = childrenOmitted;
            if (childrenCount !== undefined) item.childrenCount = childrenCount;
            if (truncated) item.truncated = truncated;
            return item;
        };

        const tree = formatNode(treeBase, 0);
        const nodeCount = maxNodes - budget.left + 1; // +1 for root
        return { tree, nodeCount, truncated };
    }
}
