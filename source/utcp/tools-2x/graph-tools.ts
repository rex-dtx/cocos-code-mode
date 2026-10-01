import { JsonSchema } from '@utcp/sdk';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { GraphOperation, resolveProjectGraphCache, runGraphWorker } from '../graph-runtime';

type GraphInput = {
    operation: GraphOperation;
    bundle?: string;
    source?: 'disk' | 'auto';
    refresh?: boolean;
    text?: string;
    byComponent?: string;
    byScript?: string;
    componentUuid?: string;
    pathGlob?: string;
    explain?: boolean;
    handle?: string;
    uuid?: string;
    relation?: 'ancestors' | 'children' | 'descendants';
    depth?: number;
    assetUuid?: string;
    limit?: number;
    cursor?: number;
};

const handleSchema: JsonSchema = {
    type: 'object', properties: {
        handle: { type: 'string' }, uuid: { type: 'string' }, path: { type: 'string' },
        name: { type: 'string' }, file: { type: 'string' }, source: { type: 'string' }, bundle: { type: 'string' }, reason: { type: 'string' },
    }, required: ['handle', 'uuid', 'path', 'name', 'file', 'source', 'bundle'],
};
const shardSchema: JsonSchema = {
    type: 'object', properties: {
        name: { type: 'string' }, source: { type: 'string' }, files: { type: 'integer' }, bytes: { type: 'integer' },
        builtAt: { type: ['integer', 'null'] }, ageMs: { type: ['integer', 'null'] }, dirty: { type: ['boolean', 'string'] },
        prefabOpaque: { type: 'boolean' }, graphAvailable: { type: 'boolean' },
    }, required: ['name', 'source', 'files', 'bytes', 'builtAt', 'ageMs', 'dirty', 'prefabOpaque', 'graphAvailable'],
};
const staleSchema: JsonSchema = {
    type: 'object', properties: {
        age_ms: { type: 'number' }, dirty: { type: ['boolean', 'string'] }, advisory: { type: 'boolean' }, prefabOpaque: { type: 'boolean' },
    }, required: ['age_ms', 'dirty', 'advisory', 'prefabOpaque'],
};
const responseSchema: JsonSchema = {
    type: 'object', properties: {
        operation: { type: 'string' }, cacheRoot: { type: 'string' }, built: { type: 'boolean' }, supported: { type: 'boolean' },
        parserVersion: { type: ['string', 'null'] }, builtAt: { type: 'integer' }, stale: { anyOf: [staleSchema, { type: 'boolean' }] },
        shards: { type: 'array', items: shardSchema }, totalShards: { type: 'integer' },
        total: { type: 'integer' }, truncated: { type: 'boolean' }, cursor: { type: ['integer', 'null'] },
        handles: { type: 'array', items: handleSchema }, candidates: { type: 'array', items: handleSchema }, totalCandidates: { type: 'integer' }, node: handleSchema,
        status: { type: 'string' }, relation: { type: 'string' }, bundle: { type: 'string' }, valid: { type: 'boolean' },
        nodes: { type: 'integer' }, components: { type: 'integer' }, references: { type: 'integer' },
        source: { type: 'string' }, dirty: { type: ['boolean', 'string'] }, prefabOpaque: { type: 'boolean' }, shard: shardSchema,
        refs: { type: 'array', items: { type: 'object', properties: {
            node: { type: 'string' }, nodeUuid: { type: 'string' }, file: { type: 'string' }, source: { type: 'string' },
            uuid: { type: 'string' }, prop: { type: 'string' }, bundle: { type: 'string' },
        }, required: ['node', 'nodeUuid', 'file', 'source', 'uuid', 'prop', 'bundle'] } },
    }, required: ['operation'],
};

function invalid(message: string): never {
    throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message });
}

export class GraphTools {
    @utcpTool('graphManage', 'Inspect, explicitly build, and query the active Creator 2.4 project disk graph. Graph handles are offline evidence, not live scene identities; verify a target in Creator before mutation. Live/auto overlay is unsupported.', {
        type: 'object', additionalProperties: false,
        properties: {
            operation: { type: 'string', enum: ['status', 'build', 'query', 'resolve', 'navigate', 'refs', 'validate'] },
            bundle: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^\\/]+$' },
            source: { type: 'string' },
            text: { type: 'string', minLength: 1, maxLength: 256 },
            byComponent: { type: 'string', minLength: 1, maxLength: 256 },
            byScript: { type: 'string', minLength: 1, maxLength: 256 },
            componentUuid: { type: 'string', minLength: 1, maxLength: 256 },
            pathGlob: { type: 'string', minLength: 1, maxLength: 2048 },
            explain: { type: 'boolean' },
            handle: { type: 'string', minLength: 1, maxLength: 2048 },
            uuid: { type: 'string', minLength: 1, maxLength: 256 },
            relation: { type: 'string', enum: ['ancestors', 'children', 'descendants'] },
            depth: { type: 'integer', minimum: 1, maximum: 32 },
            assetUuid: { type: 'string', minLength: 1, maxLength: 256 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'integer', minimum: 0, maximum: 10000000 },
        }, required: ['operation'],
    }, responseSchema, 'POST', ['graph', 'scene', 'asset', 'structure', 'query', 'resolve', 'navigate', 'references', 'validate'])
    async graphManage(args: GraphInput): Promise<Record<string, unknown>> {
        if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('graphManage requires an operation object.');
        const allowed = ['operation', 'bundle', 'source', 'refresh', 'text', 'byComponent', 'byScript', 'componentUuid', 'pathGlob', 'explain', 'handle', 'uuid', 'relation', 'depth', 'assetUuid', 'limit', 'cursor'];
        for (const key of Object.keys(args)) if (!allowed.includes(key)) invalid(`Unknown graphManage argument: ${key}.`);
        const operation = args.operation;
        if (!['status', 'build', 'query', 'resolve', 'navigate', 'refs', 'validate'].includes(operation)) invalid('Invalid graph operation.');
        if (args.source !== undefined && args.source !== 'disk') invalid('Creator 2.4 live/auto graph overlay is unsupported; use source=disk.');
        if (args.refresh !== undefined) invalid('Automatic graph refresh is unsupported; call operation=build explicitly.');
        if (args.bundle !== undefined && (typeof args.bundle !== 'string' || !args.bundle || args.bundle.length > 128 || args.bundle === '.' || args.bundle === '..' || /[\\/\0]/.test(args.bundle))) invalid('bundle must be a top-level asset bundle name.');
        if (!['status', 'build'].includes(operation) && !args.bundle) invalid(`${operation} requires bundle.`);
        const strings: (keyof GraphInput)[] = ['text', 'byComponent', 'byScript', 'componentUuid', 'pathGlob', 'handle', 'uuid', 'assetUuid'];
        for (const key of strings) {
            const value = args[key];
            if (value !== undefined && (typeof value !== 'string' || !value || value.length > (key === 'pathGlob' || key === 'handle' ? 2048 : 256))) invalid(`${key} must be a bounded nonempty string.`);
        }
        if (args.explain !== undefined && typeof args.explain !== 'boolean') invalid('explain must be boolean.');
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200)) invalid('limit must be an integer from 1 to 200.');
        if (args.cursor !== undefined && (!Number.isInteger(args.cursor) || args.cursor < 0 || args.cursor > 10000000)) invalid('cursor must be an integer from 0 to 10000000.');
        if (args.depth !== undefined && (!Number.isInteger(args.depth) || args.depth < 1 || args.depth > 32)) invalid('depth must be an integer from 1 to 32.');
        if (operation === 'resolve' && Boolean(args.handle) === Boolean(args.uuid)) invalid('resolve requires exactly one of handle or uuid.');
        if (operation === 'navigate' && (!args.handle || !['ancestors', 'children', 'descendants'].includes(args.relation!))) invalid('navigate requires handle and a valid relation.');
        if (operation === 'refs' && !args.assetUuid) invalid('refs requires assetUuid.');
        const cache = resolveProjectGraphCache(Editor.Project?.path);
        const result = await runGraphWorker(operation, {
            ...cache, bundle: args.bundle,
            query: { byComponent: args.byComponent, byScript: args.byScript, componentUuid: args.componentUuid, pathGlob: args.pathGlob, text: args.text, explain: args.explain ?? false, limit: args.limit ?? 50, cursor: args.cursor ?? 0 },
            locator: { handle: args.handle, uuid: args.uuid },
            navigation: { handle: args.handle, relation: args.relation, depth: args.depth ?? 1, limit: args.limit ?? 50, cursor: args.cursor ?? 0 },
            assetUuid: args.assetUuid,
        });
        return { operation, ...result };
    }
}
