import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { TextDecoder } from 'util';
import { isMessageNotExposed } from '../utils/editor-message-error';
const DEFAULT_EFFECT_RESULTS = 200;
const MAX_EFFECT_RESULTS = 1000;
const DEFAULT_RAW_DATA_BYTES = 512 * 1024;
const MAX_RAW_DATA_BYTES = 1024 * 1024;
function boundedPositive(value: unknown, fallback: number, maximum: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(value, maximum)
        : fallback;
}

function truncateUtf8(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, 'utf8');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let end = Math.min(bytes.length, maxBytes); end > 0; end--) {
        try {
            return decoder.decode(bytes.subarray(0, end));
        } catch {
            // Retry at the preceding byte boundary when maxBytes splits a code point.
        }
    }
    return '';
}


// Material / effect inspection and asset-db introspection.
//
// Message signatures come from the scene facade
// (@cocos/creator-types/.../cce/3d/facade/general-scene-facade.d.ts:139-142) and were
// checked against the 3.7.3 registry dump in docs/cc-3x7-message-registry.json.
// The facade types these as Promise<any>, so every result is passed through as-is —
// shapes are not runtime-verified yet.

export class MaterialTools {

    @utcpTool(
        'materialQuery',
        'Inspect materials/effects/render pipeline. Effects return at most 200 results by default and 1,000 at most.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['effects', 'effect', 'material', 'serialized_material', 'render_pipeline', 'physics_material'] },
                reference: { ...InstanceReferenceSchema, description: 'For material / serialized_material / render_pipeline / physics_material: the asset' },
                effectName: { type: 'string', description: 'For effect: the effect name as listed by the "effects" operation' },
                limit: { type: 'number', minimum: 1, maximum: MAX_EFFECT_RESULTS, default: DEFAULT_EFFECT_RESULTS, description: 'For effects: maximum effects returned' },
            },
            required: ['operation'],
            oneOf: [
                { properties: { operation: { const: 'effects' } } },
                { properties: { operation: { const: 'effect' } }, required: ['effectName'] },
                { properties: { operation: { const: 'material' } }, required: ['reference'] },
                { properties: { operation: { const: 'serialized_material' } }, required: ['reference'] },
                { properties: { operation: { const: 'render_pipeline' } }, required: ['reference'] },
                { properties: { operation: { const: 'physics_material' } }, required: ['reference'] },
            ],
        },
        { type: 'object', properties: { result: {}, total: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['result'] }, "GET",
        ['material', 'effect', 'shader', 'render', 'pipeline', 'inspect', 'physics']
    )
    async materialQuery(args: { operation: string, reference?: IInstanceReference, effectName?: string, limit?: number }): Promise<{ result: unknown, total?: number, truncated?: boolean }> {
        switch (args.operation) {
            case 'effects': {
                const rawEffects = await Editor.Message.request('scene', 'query-all-effects' as never);
                const effects: unknown[] = Array.isArray(rawEffects) ? rawEffects : [];
                const limit = boundedPositive(args.limit, DEFAULT_EFFECT_RESULTS, MAX_EFFECT_RESULTS);
                return { result: effects.slice(0, limit), total: effects.length, truncated: effects.length > limit };
            }

            case 'effect':
                if (!args.effectName) {
                    throw new Error('materialQuery "effect" requires effectName');
                }
                return { result: await Editor.Message.request('scene', 'query-effect' as any, args.effectName) };

            case 'material':
                if (!args.reference?.id) {
                    throw new Error('materialQuery "material" requires reference');
                }
                return { result: await Editor.Message.request('scene', 'query-material' as any, args.reference.id) };

            case 'serialized_material':
                if (!args.reference?.id) {
                    throw new Error('materialQuery "serialized_material" requires reference');
                }
                return { result: await Editor.Message.request('scene', 'query-serialized-material' as any, args.reference.id) };

            case 'render_pipeline':
                if (!args.reference?.id) {
                    throw new Error('materialQuery "render_pipeline" requires reference');
                }
                return { result: await Editor.Message.request('scene', 'query-render-pipeline' as any, args.reference.id) };

            case 'physics_material':
                if (!args.reference?.id) {
                    throw new Error('materialQuery "physics_material" requires reference');
                }
                return { result: await Editor.Message.request('scene', 'query-physics-material' as any, args.reference.id) };

            default:
                throw new Error(`Unknown materialQuery operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'assetDbQuery',
        'Introspect asset-db: databases list, busy status, mtime, raw imported data, ready/missing. Raw data is capped at 512KB by default and 1MB at most.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['databases', 'busy', 'mtime', 'data', 'db_info', 'meta', 'ready', 'missing'] },
                reference: { ...InstanceReferenceSchema, description: 'For mtime / data / meta / missing: the asset; db_info also accepts reference.id' },
                dbName: { type: 'string', description: 'For db_info: database name, e.g. assets or internal' },
                maxBytes: { type: 'number', minimum: 1, maximum: MAX_RAW_DATA_BYTES, default: DEFAULT_RAW_DATA_BYTES, description: 'For data: maximum serialized bytes returned' },
            },
            required: ['operation'],
            oneOf: [
                { properties: { operation: { const: 'databases' } } },
                { properties: { operation: { const: 'busy' } } },
                { properties: { operation: { const: 'mtime' } }, required: ['reference'] },
                { properties: { operation: { const: 'data' } }, required: ['reference'] },
                { properties: { operation: { const: 'db_info' } } },
                { properties: { operation: { const: 'meta' } }, required: ['reference'] },
                { properties: { operation: { const: 'ready' } } },
                { properties: { operation: { const: 'missing' } }, required: ['reference'] },
            ],
        },
        { type: 'object', properties: { result: {}, bytes: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['result'] }, "GET",
        ['asset', 'database', 'db', 'mtime', 'busy', 'introspect', 'db-info', 'meta', 'ready', 'missing']
    )
    async assetDbQuery(args: { operation: string, reference?: IInstanceReference, dbName?: string, maxBytes?: number }): Promise<{ result: unknown, bytes?: number, truncated?: boolean }> {
        switch (args.operation) {
            case 'databases':
                return { result: await Editor.Message.request('asset-db', 'query-db-list' as any) };

            case 'busy':
                return { result: await Editor.Message.request('asset-db', 'is-busy' as any) };

            case 'mtime':
                if (!args.reference?.id) {
                    throw new Error('assetDbQuery "mtime" requires reference');
                }
                return { result: await Editor.Message.request('asset-db', 'query-asset-mtime' as any, args.reference.id) };

            case 'data': {
                if (!args.reference?.id) {
                    throw new Error('assetDbQuery "data" requires reference');
                }
                const rawData = await Editor.Message.request('asset-db', 'query-asset-data' as never, args.reference.id);
                const serialized = JSON.stringify(rawData) ?? 'null';
                const bytes = Buffer.byteLength(serialized, 'utf8');
                const maxBytes = boundedPositive(args.maxBytes, DEFAULT_RAW_DATA_BYTES, MAX_RAW_DATA_BYTES);
                if (bytes > maxBytes) {
                    const content = truncateUtf8(serialized, maxBytes);
                    return { result: content, bytes, truncated: true };
                }
                return { result: rawData, bytes, truncated: false };
            }

            case 'db_info': {
                const name = args.dbName || args.reference?.id || 'assets';
                return { result: await Editor.Message.request('asset-db', 'query-db-info' as any, name) };
            }

            // Read side of assetOperate save_meta — meta writes are read-modify-write.
            case 'meta':
                if (!args.reference?.id) {
                    throw new Error('assetDbQuery "meta" requires reference');
                }
                return { result: await Editor.Message.request('asset-db', 'query-asset-meta' as any, args.reference.id) };

            case 'ready':
                // Typed in creator-types (asset-db::query-ready) — polls whether the
                // asset-db has finished its initial open.
                return { result: await Editor.Message.request('asset-db', 'query-ready' as any) };

            case 'missing': {
                // Typed in creator-types (asset-db::query-missing-asset-info) —
                // returns MissingAssetInfo for dangling refs in the asset graph.
                if (!args.reference?.id) {
                    throw new Error('assetDbQuery "missing" requires reference.id (uuid or db:// path string)');
                }
                try {
                    return { result: await Editor.Message.request('asset-db', 'query-missing-asset-info' as any, args.reference.id) };
                } catch (e: any) {
                    if (isMessageNotExposed(e, 'asset-db', 'query-missing-asset-info')) throw new Error('assetDbQuery "missing" is not supported on this editor version (message added after 3.7.3)');
                    throw e;
                }
            }

            default:
                throw new Error(`Unknown assetDbQuery operation: ${args.operation}`);
        }
    }
}
