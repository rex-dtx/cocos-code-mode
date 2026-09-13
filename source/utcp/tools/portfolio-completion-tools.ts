import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { UiTools } from './ui-tools';
import { AssetTools } from './asset-tools';

const MAX_VISIBLE_ITEMS = 20;

export class PortfolioCompletionTools {
    @utcpTool('assetSceneUsageAudit', 'Audit bounded scene-root reachability using Creator asset graph v4 evidence.', {
        type: 'object', additionalProperties: false,
        properties: {
            assetPath: { type: 'string', minLength: 1, maxLength: 256 },
            maxAssets: { type: 'integer', minimum: 1, maximum: 128, default: 64 },
            maxGraphAssets: { type: 'integer', minimum: 1, maximum: 5000, default: 5000 },
            sceneReferences: { type: 'array', minItems: 1, maxItems: 128, items: InstanceReferenceSchema },
        },
    }, {
        type: 'object', properties: {
            graphVersion: { type: 'string' }, complete: { type: 'boolean' }, roots: { type: 'array' },
            graphAssets: { type: 'integer' }, graphEdges: { type: 'integer' }, candidates: { type: 'array' },
            referenceEvidence: { type: 'array' }, dynamicLoadCaveat: { type: 'string' },
        }, required: ['graphVersion', 'complete', 'roots', 'graphAssets', 'graphEdges', 'candidates', 'referenceEvidence', 'dynamicLoadCaveat'],
    }, 'GET', ['asset', 'scene', 'usage', 'audit'])
    async assetSceneUsageAudit(args: { assetPath?: string, maxAssets?: number, maxGraphAssets?: number, sceneReferences?: IInstanceReference[] } = {}): Promise<Record<string, unknown>> {
        const result = await new AssetTools().assetUsageAnalyze({
            assetPath: args.assetPath,
            maxAssets: args.maxAssets,
            maxGraphAssets: args.maxGraphAssets,
            rootReferences: args.sceneReferences,
        });
        return result;
    }


    @utcpTool('uiVirtualListCreate', 'Create a bounded ScrollView-backed virtual-list shell and materialize only the declared visible item window.', {
        type: 'object', additionalProperties: false,
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 128 }, parentReference: InstanceReferenceSchema,
            itemCount: { type: 'integer', minimum: 0, maximum: 100000 },
            visibleItems: { type: 'integer', minimum: 1, maximum: MAX_VISIBLE_ITEMS },
        }, required: ['itemCount', 'visibleItems'],
    }, {
        type: 'object', properties: { reference: { type: 'object' }, viewport: { type: 'object' }, content: { type: 'object' }, itemReferences: { type: 'array' }, itemCount: { type: 'integer' }, instantiatedItems: { type: 'integer' }, virtualized: { type: 'boolean' } },
        required: ['reference', 'viewport', 'content', 'itemReferences', 'itemCount', 'instantiatedItems', 'virtualized'],
    }, 'POST', ['ui', 'virtual', 'list', 'create'])
    async uiVirtualListCreate(args: { name?: string, parentReference?: IInstanceReference, itemCount: number, visibleItems: number }): Promise<Record<string, unknown>> {
        if (args.visibleItems > MAX_VISIBLE_ITEMS) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `visibleItems must not exceed ${MAX_VISIBLE_ITEMS}.` });
        const ui = new UiTools();
        const list = await ui.uiCreateScrollView({ name: args.name ?? 'VirtualList', parentReference: args.parentReference });
        const materialized = Math.min(args.itemCount, args.visibleItems);
        const itemReferences: IInstanceReference[] = [];
        for (let index = 0; index < materialized; index++) {
            const item = await ui.createLabel({ name: `Item-${index}`, text: String(index), parentReference: list.content });
            itemReferences.push(item.reference);
        }
        await Editor.Message.request('scene', 'snapshot');
        return { ...list, itemReferences, itemCount: args.itemCount, instantiatedItems: materialized, virtualized: args.itemCount > materialized };
    }
}
