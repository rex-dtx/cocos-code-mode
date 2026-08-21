import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';

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
        'Inspect materials/effects/render pipeline. Operations: effects, effect, material, serialized_material, render_pipeline.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['effects', 'effect', 'material', 'serialized_material', 'render_pipeline', 'physics_material'] },
                reference: { ...InstanceReferenceSchema, description: 'For material / serialized_material / render_pipeline: the asset' },
                effectName: { type: 'string', description: 'For effect: the effect name as listed by the "effects" operation' }
            },
            required: ['operation']
        },
        { type: 'object', properties: { result: {} } }, "GET",
        ['material', 'effect', 'shader', 'render', 'pipeline', 'inspect', 'physics']
    )
    async materialQuery(args: { operation: string, reference?: IInstanceReference, effectName?: string }): Promise<{ result: any }> {
        switch (args.operation) {
            case 'effects':
                return { result: await Editor.Message.request('scene', 'query-all-effects' as any) };

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
        'Introspect asset-db: databases list, busy status, mtime, raw imported data.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['databases', 'busy', 'mtime', 'data', 'db_info'] },
                reference: { ...InstanceReferenceSchema, description: 'For mtime / data / db_info: the asset (db_info also accepts dbName)' },
                dbName: { type: 'string', description: 'For db_info: database name, e.g. assets or internal' }
            },
            required: ['operation']
        },
        { type: 'object', properties: { result: {} } }, "GET",
        ['asset', 'database', 'db', 'mtime', 'busy', 'introspect', 'db-info']
    )
    async assetDbQuery(args: { operation: string, reference?: IInstanceReference, dbName?: string }): Promise<{ result: any }> {
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

            case 'data':
                if (!args.reference?.id) {
                    throw new Error('assetDbQuery "data" requires reference');
                }
                return { result: await Editor.Message.request('asset-db', 'query-asset-data' as any, args.reference.id) };

            case 'db_info': {
                const name = args.dbName || args.reference?.id || 'assets';
                return { result: await Editor.Message.request('asset-db', 'query-db-info' as any, name) };
            }

            default:
                throw new Error(`Unknown assetDbQuery operation: ${args.operation}`);
        }
    }
}
