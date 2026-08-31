import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, SceneTreeItemSchema } from '../schemas';

const MAX_SNAPSHOT_DEPTH = 99;
const MAX_SNAPSHOT_NODES = 5000;
const MAX_SNAPSHOT_FIELDS = 100;

// sceneSnapshot — bounded scene dump for diff / full-state hand-off.
// Reuses query-node-tree with generous server-enforced limits. Richer than
// nodeGetTree's default budgets (4/200) — use nodeGetTree for navigational queries.

export class SceneSnapshotTools {

    @utcpTool(
        'sceneSnapshot',
        'Full scene dump for diffing or handing scene state to an agent. Defaults maxDepth=99/maxNodes=5000; limits are capped at those values. Supports fields filter.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                maxDepth: { type: 'integer', minimum: 0, maximum: MAX_SNAPSHOT_DEPTH, description: 'Max recursion depth (default and cap 99)' },
                maxNodes: { type: 'integer', minimum: 1, maximum: MAX_SNAPSHOT_NODES, description: 'Max nodes to walk, including the root (default and cap 5000)' },
                fields: { type: 'array', maxItems: MAX_SNAPSHOT_FIELDS, items: { type: 'string', minLength: 1 }, description: `Optional field whitelist per node (maximum ${MAX_SNAPSHOT_FIELDS} items). Omit for all fields.` },
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

        if (args.maxDepth !== undefined && (!Number.isInteger(args.maxDepth) || args.maxDepth < 0)) {
            throw new Error('sceneSnapshot maxDepth must be a non-negative integer');
        }
        if (args.maxNodes !== undefined && (!Number.isInteger(args.maxNodes) || args.maxNodes < 1)) {
            throw new Error('sceneSnapshot maxNodes must be a positive integer');
        }
        if (args.fields !== undefined && (!Array.isArray(args.fields) || args.fields.length > MAX_SNAPSHOT_FIELDS || !args.fields.every((field) => typeof field === 'string' && field.length > 0))) {
            throw new Error(`sceneSnapshot fields must contain at most ${MAX_SNAPSHOT_FIELDS} non-empty strings`);
        }
        const maxDepth = Math.min(args.maxDepth ?? MAX_SNAPSHOT_DEPTH, MAX_SNAPSHOT_DEPTH);
        const maxNodes = Math.min(args.maxNodes ?? MAX_SNAPSHOT_NODES, MAX_SNAPSHOT_NODES);
        const budget = { left: maxNodes - 1 };
        const fieldSet = args.fields?.length ? new Set(args.fields) : null;
        const want = (k: string) => !fieldSet || fieldSet.has(k);

        let truncated: string | undefined;

        const formatNode = (node: any, depth: number): any => {
            const atMaxDepth = depth >= maxDepth;
            let children: any[] = [];
            let childrenOmitted: number | undefined;
            let childrenCount: number | undefined;
            let nodeTruncated: string | undefined;

            if (!atMaxDepth) {
                const rawChildren: any[] = node.children || [];
                if (rawChildren.length) {
                    childrenCount = rawChildren.length;
                    for (let i = 0; i < rawChildren.length; i++) {
                        if (budget.left <= 0) { nodeTruncated = 'nodeLimit'; truncated = nodeTruncated; childrenOmitted = rawChildren.length - i; break; }
                        budget.left--;
                        children.push(formatNode(rawChildren[i], depth + 1));
                    }
                }
            } else if (node.children?.length) {
                nodeTruncated = 'maxDepth';
                truncated = nodeTruncated;
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
            if (nodeTruncated) item.truncated = nodeTruncated;
            return item;
        };

        const tree = formatNode(treeBase, 0);
        const nodeCount = maxNodes - budget.left;
        return { tree, nodeCount, truncated };
    }
}
