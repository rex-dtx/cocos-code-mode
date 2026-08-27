import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { ToolsUtils } from '../utils/tools-utils';

// M2 — Batch property reads as 1 HTTP tool instead of N individual GETs.
// Cargo cult N HTTP == N*N round trips; batch tool collapses to 1.
export class BatchReadTools {

    @utcpTool(
        'sceneBatchGet',
        'Batch inspectorGet across many nodes — one HTTP call instead of N. Grant parity with sceneBatchSet for read-side batch.',
        {
            type: 'object',
            properties: {
                entries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            reference: InstanceReferenceSchema,
                            target: { type: 'string', enum: ['instance', 'CurrentSceneGlobals', 'ProjectSettings'], description: 'Where to read from (default instance)' },
                            fields: { type: 'array', items: { type: 'string' }, description: 'Field filter applied to each dump' },
                        },
                        required: ['reference'],
                    },
                },
                fields: { type: 'array', items: { type: 'string' }, description: 'Field filter applied to every entry if entry.fields absent' },
            },
            required: ['entries'],
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } } }, required: ['results'] },
        'POST',
        ['batch', 'read', 'inspector', 'scene', 'dump', 'multi']
    )
    async sceneBatchGet(args: { entries: Array<{ reference: IInstanceReference, target?: string, fields?: string[] }>, fields?: string[] }): Promise<{ results: Array<{ reference: IInstanceReference, dump: any } | { reference: IInstanceReference, error: string }> }> {
        const entriesArr: any[] = Array.isArray(args.entries) ? args.entries : (args.entries ? Object.values(args.entries as any) : []);
        if (!entriesArr.length) throw new Error('sceneBatchGet requires non-empty entries');

        const settled = await Promise.allSettled(entriesArr.map(async (e: any) => {
            const target = e.target ?? 'instance';
            const fields = e.fields ?? args.fields;
            const id = target === 'instance'
                ? (e.reference?.id ?? (() => { throw new Error('instance requires reference.id'); })())
                : target;
            const info = await ToolsUtils.inspectInstance(id as string);
            if (!info) throw new Error(`Target ${id} not found`);
            if (!info.props) throw new Error(`No properties for ${id}`);
            let props: any = info.props;
            if (fields?.length) {
                const filtered: any = {};
                for (const k of fields) if (k in props) filtered[k] = (props as any)[k];
                props = filtered;
            }
            const dump = ToolsUtils.unwrapProperties(props);
            return { reference: e.reference, dump };
        }));

        const results = settled.map((s: any, i: number) => s.status === 'fulfilled'
            ? s.value as { reference: IInstanceReference, dump: any }
            : { reference: entriesArr[i].reference, error: (s as PromiseRejectedResult).reason?.message || String((s as PromiseRejectedResult).reason) }
        );
        return { results };
    }

    @utcpTool(
        'assetBatchQuery',
        'Batch asset queries across many db:// patterns. One HTTP instead of N assetQuery calls.',
        {
            type: 'object',
            properties: {
                queries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            pattern: { type: 'string' },
                            ccType: { type: 'string' },
                            importer: { type: 'string' },
                            extname: { type: 'string' },
                            isBundle: { type: 'boolean' },
                            limit: { type: 'number' },
                        },
                    },
                },
            },
            required: ['queries'],
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } } }, required: ['results'] },
        'POST',
        ['batch', 'asset', 'query', 'multi', 'bulk']
    )
    async assetBatchQuery(args: { queries: Array<{ pattern?: string, ccType?: string, importer?: string, extname?: string, isBundle?: boolean, limit?: number }> }): Promise<{ results: any[] }> {
        const queriesArr: any[] = Array.isArray(args.queries) ? args.queries : (args.queries ? Object.values(args.queries as any) : []);
        if (!queriesArr.length) throw new Error('assetBatchQuery requires non-empty queries');
        const { AssetTools } = await import('./asset-tools');
        const tool = new (AssetTools as any)();
        const results = await Promise.all(queriesArr.map((q: any) => tool.assetQuery(q)));
        return { results };
    }
}
