import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { AssetReadTools } from './asset-read-tools';

const MAX_BATCH = 100;
const OPS = ['search', 'tree', 'info', 'meta', 'types', 'sub_assets', 'used_by', 'metas'] as const;

export type AssetBatchQuery = {
    operation: string;
    pattern?: string;
    assetTypes?: any;
    url?: string;
    uuid?: string;
    limit?: number;
    maxDepth?: number;
    maxResults?: number;
    type?: string;
};

export function validateAssetBatchQueries(queries: unknown): AssetBatchQuery[] {
    if (!Array.isArray(queries) || queries.length === 0 || queries.length > MAX_BATCH) {
        throw new ToolError({
            code: 'INVALID_BATCH',
            status: 400,
            message: `assetBatchQuery requires 1-${MAX_BATCH} queries`,
            recovery: 'Pass queries as an array of 1-100 assetQuery argument objects.',
        });
    }
    return queries.map((query, index) => {
        if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new ToolError({
                code: 'INVALID_BATCH',
                status: 400,
                message: `assetBatchQuery query ${index + 1} must be an object`,
                recovery: 'Each query needs operation plus the fields assetQuery accepts.',
            });
        }
        const operation = (query as AssetBatchQuery).operation;
        if (typeof operation !== 'string' || !(OPS as readonly string[]).includes(operation)) {
            throw new ToolError({
                code: 'INVALID_BATCH',
                status: 400,
                message: `assetBatchQuery query ${index + 1} has invalid operation`,
                recovery: `operation must be one of ${OPS.join(', ')}.`,
            });
        }
        return query as AssetBatchQuery;
    });
}

export class BatchAssetTools {
    @utcpTool(
        'assetBatchQuery',
        'Batch 1-100 assetQuery operations in one call. Each query needs a valid assetQuery operation.',
        {
            type: 'object',
            properties: {
                queries: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_BATCH,
                    items: {
                        type: 'object',
                        properties: {
                            operation: { type: 'string', enum: [...OPS] },
                            pattern: { type: 'string' },
                            url: { type: 'string' },
                            uuid: { type: 'string' },
                            limit: { type: 'number' },
                            maxDepth: { type: 'number' },
                            maxResults: { type: 'number' },
                            type: { type: 'string' },
                        },
                        required: ['operation'],
                    },
                },
            },
            required: ['queries'],
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } } }, required: ['results'] },
        'POST',
        ['batch', 'asset', 'query', 'multi', 'bulk']
    )
    async assetBatchQuery(args: { queries: AssetBatchQuery[] }): Promise<{ results: unknown[] }> {
        const queries = validateAssetBatchQueries(args.queries);
        const tool = new AssetReadTools();
        const results: unknown[] = [];
        for (const query of queries) {
            try {
                results.push(await tool.assetQuery(query));
            } catch (e) {
                const reason = e instanceof Error ? e.message : String(e);
                results.push({ error: reason, operation: query.operation });
            }
        }
        return { results };
    }
}
