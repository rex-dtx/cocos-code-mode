import fs from 'fs-extra';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { AssetTools } from './asset-tools';
import { ExpansionTools } from './expansion-tools';

const GRAPH_PRESET = 'db://internal/default_file_content/animgraph';
const ASSET_PATH_PATTERN = /^db:\/\/assets\/[A-Za-z0-9._/-]+$/;
const SKELETAL_FIELDS = ['playOnLoad', 'useBakedAnimation'] as const;
type SkeletalField = typeof SKELETAL_FIELDS[number];

function invalid(message: string): never {
    throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message });
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function unwrap(value: unknown): unknown {
    if (value && typeof value === 'object' && 'value' in value) return (value as { value: unknown }).value;
    return value;
}

function componentType(component: any): string {
    return String(component?.type ?? component?.value?.__type__?.value ?? component?.value?.__type__ ?? component?.cid ?? '');
}

function componentId(component: any): string | undefined {
    const value = unwrap(component?.value?.uuid ?? component?.uuid);
    return typeof value === 'string' && value ? value : undefined;
}

function assetReference(asset: any, fallback?: string): IInstanceReference {
    const id = typeof asset?.uuid === 'string' ? asset.uuid : fallback;
    if (!id) throw new ToolError({ code: 'INVALID_RESPONSE', status: 502, message: 'Creator did not return a stable asset UUID.' });
    return { id, type: typeof asset?.type === 'string' && asset.type ? asset.type : 'cc.Asset' };
}

async function info(reference: IInstanceReference): Promise<any> {
    if (!reference?.id || typeof reference.id !== 'string' || reference.id.length > 256) invalid('reference.id must be a non-empty string of at most 256 characters.');
    let value: any;
    try {
        value = await Editor.Message.request('asset-db', 'query-asset-info', reference.id);
    } catch (error) {
        throw new ToolError({ code: 'ASSET_QUERY_FAILED', status: 502, message: `Could not query asset ${reference.id}.`, details: { cause: error instanceof Error ? error.message : String(error) } });
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Asset ${reference.id} was not found.` });
    return value;
}

function safeGraphPath(assetPath: unknown): string {
    if (typeof assetPath !== 'string' || assetPath.length < 1 || assetPath.length > 256 || !ASSET_PATH_PATTERN.test(assetPath) || assetPath.includes('..')) {
        invalid('assetPath must be a project db://assets path without traversal.');
    }
    return assetPath.endsWith('.animgraph') ? assetPath : `${assetPath}.animgraph`;
}

function metadataNames(value: unknown, keys: string[]): string[] {
    if (!value || typeof value !== 'object') return [];
    for (const key of keys) {
        const candidate = (value as Record<string, unknown>)[key];
        if (!Array.isArray(candidate)) continue;
        const names = candidate.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && typeof (item as any).name === 'string') return (item as any).name;
            return '';
        }).filter((item): item is string => !!item).slice(0, 256);
        if (names.length) return [...new Set(names)];
    }
    return [];
}

function animationMetadata(asset: any): { joints: string[], clips: string[], skeletonId?: string } {
    const userData = asset?.meta?.userData;
    const candidates = [asset?.skeleton, asset?.skeletonData, userData?.skeleton, userData, asset];
    let joints: string[] = [];
    let clips: string[] = [];
    let skeletonId: string | undefined;
    for (const candidate of candidates) {
        if (!joints.length) joints = metadataNames(candidate, ['joints', 'jointNames', 'bones', 'boneNames']);
        if (!clips.length) clips = metadataNames(candidate, ['clips', 'clipNames', 'animations', 'animationNames']);
        if (!skeletonId && candidate && typeof candidate === 'object') {
            for (const key of ['skeletonId', 'skeletonUuid', 'skeletonUUID']) {
                if (typeof (candidate as any)[key] === 'string' && (candidate as any)[key]) {
                    skeletonId = (candidate as any)[key];
                    break;
                }
            }
        }
    }
    return { joints, clips, ...(skeletonId ? { skeletonId } : {}) };
}

function nodeComponents(node: any): any[] {
    return Array.isArray(node?.__comps__) ? node.__comps__ : Array.isArray(node?.components) ? node.components : [];
}

async function queryNode(id: string): Promise<any> {
    let node: any;
    try {
        node = await Editor.Message.request('scene', 'query-node', id);
    } catch (error) {
        throw new ToolError({ code: 'SCENE_QUERY_FAILED', status: 502, message: `Could not query scene node ${id}.`, details: { cause: error instanceof Error ? error.message : String(error) } });
    }
    if (!node || typeof node !== 'object') throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Scene node ${id} was not found.` });
    return node;
}

export class PortfolioValidationTools {
    @utcpTool('assetBundleValidate', 'Validate bounded bundle metadata for one imported asset.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, expectedBundle: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, reference: { type: 'object' }, bundle: {}, issues: { type: 'array' }, runtimeCaveat: { type: 'string' } }, required: ['valid', 'reference', 'bundle', 'issues', 'runtimeCaveat'] }, 'GET', ['asset', 'bundle', 'validate'])
    async assetBundleValidate(args: { reference: IInstanceReference, expectedBundle?: string }) {
        const asset = await info(args.reference); const meta = asset.meta as any; const data = meta?.userData as any;
        const bundle = typeof data?.bundleName === 'string' ? data.bundleName : typeof data?.bundle === 'string' ? data.bundle : null;
        const issues = args.expectedBundle !== undefined && bundle !== args.expectedBundle ? [{ code: 'BUNDLE_MISMATCH', expected: args.expectedBundle, actual: bundle }] : [];
        return { valid: issues.length === 0, reference: { id: String(asset.uuid ?? args.reference.id), type: String(asset.type ?? 'cc.Asset') }, bundle, issues, runtimeCaveat: 'Metadata validation only; runtime loading is not claimed.' };
    }
    @utcpTool('physics2dQuery', 'Query bounded 2D physics topology.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, nodes: { type: 'array' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'nodes', 'issues', 'checkedNodes'] }, 'GET', ['physics', '2d', 'query'])
    async physics2dQuery(args: { reference?: IInstanceReference } = {}) { return new ExpansionTools().physics2dTopologyAudit(args); }
    @utcpTool('physics3dQuery', 'Query bounded 3D physics topology.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, nodes: { type: 'array' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'nodes', 'issues', 'checkedNodes'] }, 'GET', ['physics', '3d', 'query'])
    async physics3dQuery(args: { reference?: IInstanceReference } = {}) { return new ExpansionTools().physics3dTopologyAudit(args); }
    @utcpTool('shaderValidate', 'Validate one named Creator effect.', { type: 'object', additionalProperties: false, properties: { effectName: { type: 'string', minLength: 1, maxLength: 256 } }, required: ['effectName'] }, { type: 'object', properties: { valid: { type: 'boolean' }, effectName: { type: 'string' }, diagnostics: { type: 'array' }, result: {} }, required: ['valid', 'effectName', 'diagnostics'] }, 'GET', ['shader', 'effect', 'validate'])
    async shaderValidate(args: { effectName: string }) {
        const effects: any = await Editor.Message.request('scene', 'query-all-effects' as never);
        const entries = effects && typeof effects === 'object' && !Array.isArray(effects) ? Object.values(effects) : [];
        const match: any = entries.find((effect: any) => effect?.name === args.effectName || effect?.assetPath === args.effectName);
        const known = !!match || (effects && typeof effects === 'object' && Object.prototype.hasOwnProperty.call(effects, args.effectName));
        const queryName = match?.name ?? args.effectName;
        const result: any = known ? await Editor.Message.request('scene', 'query-effect' as never, queryName) : null;
        const valid = known && result != null && result !== false;
        return { valid, effectName: args.effectName, diagnostics: valid ? [] : [{ code: 'EFFECT_NOT_FOUND', effectName: args.effectName }], result: result ?? null };
    }
    @utcpTool('animationGraphInspect', 'Inspect a bounded JSON animation graph.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { reference: { type: 'object' }, nodes: { type: 'array' }, transitions: { type: 'array' }, nodeCount: { type: 'integer' }, transitionCount: { type: 'integer' } }, required: ['reference', 'nodes', 'transitions', 'nodeCount', 'transitionCount'] }, 'GET', ['animation', 'graph', 'inspect'])
    async animationGraphInspect(args: { reference: IInstanceReference }) { const asset = await info(args.reference); if (typeof asset.file !== 'string') throw new ToolError({ code: 'SOURCE_UNAVAILABLE', status: 422, message: 'Asset source is unavailable.' }); const value: any = JSON.parse(await fs.readFile(asset.file, 'utf8')); const nodes = Array.isArray(value.nodes) ? value.nodes.slice(0, 256) : []; const transitions = Array.isArray(value.transitions) ? value.transitions.slice(0, 512) : []; return { reference: { id: String(asset.uuid ?? args.reference.id), type: String(asset.type ?? 'cc.JsonAsset') }, nodes, transitions, nodeCount: nodes.length, transitionCount: transitions.length }; }
    @utcpTool('animationGraphValidate', 'Validate animation graph identities and endpoints.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, nodeCount: { type: 'integer' }, transitionCount: { type: 'integer' } }, required: ['valid', 'issues', 'nodeCount', 'transitionCount'] }, 'GET', ['animation', 'graph', 'validate'])
    async animationGraphValidate(args: { reference: IInstanceReference }) { const graph: any = await this.animationGraphInspect(args); const ids = new Set<string>(); const issues: any[] = []; for (const [index, node] of graph.nodes.entries()) { if (!node || typeof node.id !== 'string' || !node.id) issues.push({ code: 'INVALID_NODE_ID', index }); else if (ids.has(node.id)) issues.push({ code: 'DUPLICATE_NODE_ID', id: node.id }); else ids.add(node.id); } for (const [index, edge] of graph.transitions.entries()) if (!edge || !ids.has(edge.from) || !ids.has(edge.to)) issues.push({ code: 'INVALID_TRANSITION', index }); return { valid: issues.length === 0, issues, nodeCount: graph.nodeCount, transitionCount: graph.transitionCount }; }

    @utcpTool('animationGraphCreate', 'Create a native Creator animation graph through asset-db and verify its stable imported identity.', {
        type: 'object', additionalProperties: false,
        properties: {
            assetPath: { type: 'string', minLength: 1, maxLength: 256, pattern: '^db://assets/[A-Za-z0-9._/-]+$' },
            options: { type: 'object', additionalProperties: false, properties: { overwrite: { type: 'boolean' }, rename: { type: 'boolean' } } },
        },
        required: ['assetPath'],
    }, {
        type: 'object', additionalProperties: false,
        properties: { reference: InstanceReferenceSchema, assetPath: { type: 'string' }, verified: { type: 'boolean' } },
        required: ['reference', 'assetPath', 'verified'],
    }, 'POST', ['animation', 'graph', 'create', 'asset'])
    async animationGraphCreate(args: { assetPath: string, options?: { overwrite?: boolean, rename?: boolean } }) {
        const requestedPath = safeGraphPath(args?.assetPath);
        const options = { overwrite: args?.options?.overwrite === true, rename: args?.options?.rename === true };
        const available = await Editor.Message.request('asset-db', 'generate-available-url', requestedPath);
        const targetPath = safeGraphPath(available);
        let created: any;
        try {
            created = await Editor.Message.request('asset-db', 'copy-asset', GRAPH_PRESET, targetPath, options);
            if (!created || typeof created !== 'object' || typeof created.uuid !== 'string' || !created.uuid) {
                throw new ToolError({ code: 'CREATE_FAILED', status: 502, message: 'Creator did not return an imported animation graph identity.' });
            }
            const readBack = await info({ id: created.uuid });
            if (typeof readBack.uuid !== 'string' || readBack.uuid !== created.uuid) {
                throw new ToolError({ code: 'READBACK_MISMATCH', status: 502, message: 'Animation graph creation read-back did not preserve the created UUID.' });
            }
            const reference = assetReference(readBack, created.uuid);
            return { reference, assetPath: typeof readBack.url === 'string' ? readBack.url : targetPath, verified: true };
        } catch (error) {
            if (created?.uuid) {
                try {
                    await Editor.Message.request('asset-db', 'delete-asset', created.url ?? targetPath);
                    const removed = await Editor.Message.request('asset-db', 'query-asset-info', created.uuid);
                    if (removed) throw new Error('asset remained after delete-asset');
                } catch (rollbackError) {
                    throw new ToolError({ code: 'ROLLBACK_FAILED', status: 500, message: `Animation graph creation failed and ${created.uuid} could not be rolled back.`, details: { cause: error instanceof Error ? error.message : String(error), rollback: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) } });
                }
            }
            throw error;
        }
    }

    @utcpTool('animationRetargetValidate', 'Compare bounded source, target, joint, and clip metadata without claiming automatic retargeting.', {
        type: 'object', additionalProperties: false,
        properties: { sourceReference: InstanceReferenceSchema, targetReference: InstanceReferenceSchema, clipReference: InstanceReferenceSchema },
        required: ['sourceReference', 'targetReference'],
    }, {
        type: 'object', additionalProperties: false,
        properties: {
            valid: { type: 'boolean' }, automaticRetargeting: { type: 'boolean' },
            sourceReference: InstanceReferenceSchema, targetReference: InstanceReferenceSchema, clipReference: InstanceReferenceSchema,
            source: { type: 'object' }, target: { type: 'object' }, clip: { type: 'object' }, issues: { type: 'array', maxItems: 256 },
        },
        required: ['valid', 'automaticRetargeting', 'sourceReference', 'targetReference', 'source', 'target', 'issues'],
    }, 'GET', ['animation', 'retarget', 'validate', 'skeleton'])
    async animationRetargetValidate(args: { sourceReference: IInstanceReference, targetReference: IInstanceReference, clipReference?: IInstanceReference }) {
        if (!args?.sourceReference?.id || !args?.targetReference?.id) invalid('sourceReference and targetReference are required.');
        const sourceInfo = await info(args.sourceReference);
        const targetInfo = await info(args.targetReference);
        const source = animationMetadata(sourceInfo);
        const target = animationMetadata(targetInfo);
        const clipInfo = args.clipReference ? await info(args.clipReference) : undefined;
        const clip = clipInfo ? animationMetadata(clipInfo) : undefined;
        if (!source.joints.length || !target.joints.length) {
            throw new ToolError({
                code: 'UNSUPPORTED_METADATA',
                status: 422,
                message: 'Creator did not expose bounded skeleton joint metadata for both retarget inputs.',
                details: { sourceJointCount: source.joints.length, targetJointCount: target.joints.length },
                recovery: 'Use model assets with imported skeleton metadata exposed by asset-db.',
            });
        }
        const issues: Array<Record<string, unknown>> = [];
        const sourceSet = new Set(source.joints);
        const targetSet = new Set(target.joints);
        const missing = source.joints.filter((joint) => !targetSet.has(joint)).slice(0, 256);
        const extra = target.joints.filter((joint) => !sourceSet.has(joint)).slice(0, 256);
        if (missing.length) issues.push({ code: 'TARGET_JOINTS_MISSING', joints: missing });
        if (extra.length) issues.push({ code: 'TARGET_JOINTS_EXTRA', joints: extra });
        if (source.skeletonId && target.skeletonId && source.skeletonId !== target.skeletonId) issues.push({ code: 'SKELETON_ID_MISMATCH', source: source.skeletonId, target: target.skeletonId });
        if (clip && !clip.clips.length) issues.push({ code: 'CLIP_METADATA_UNAVAILABLE' });
        if (clip?.skeletonId && target.skeletonId && clip.skeletonId !== target.skeletonId) issues.push({ code: 'CLIP_SKELETON_MISMATCH', clip: clip.skeletonId, target: target.skeletonId });
        return {
            valid: issues.length === 0,
            automaticRetargeting: false,
            sourceReference: assetReference(sourceInfo, args.sourceReference.id),
            targetReference: assetReference(targetInfo, args.targetReference.id),
            ...(args.clipReference && clipInfo ? { clipReference: assetReference(clipInfo, args.clipReference.id) } : {}),
            source: { jointCount: source.joints.length, joints: source.joints, ...(source.skeletonId ? { skeletonId: source.skeletonId } : {}) },
            target: { jointCount: target.joints.length, joints: target.joints, ...(target.skeletonId ? { skeletonId: target.skeletonId } : {}) },
            ...(clip ? { clip: { clipCount: clip.clips.length, clips: clip.clips, ...(clip.skeletonId ? { skeletonId: clip.skeletonId } : {}) } } : {}),
            issues,
        };
    }

    @utcpTool('skeletalAnimationConfigure', 'Configure bounded serialized SkeletalAnimation component fields with read-back and rollback.', {
        type: 'object', additionalProperties: false,
        properties: {
            reference: InstanceReferenceSchema,
            properties: {
                type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 2,
                properties: { playOnLoad: { type: 'boolean' }, useBakedAnimation: { type: 'boolean' } },
            },
        },
        required: ['reference', 'properties'],
    }, {
        type: 'object', additionalProperties: false,
        properties: { reference: InstanceReferenceSchema, componentReference: InstanceReferenceSchema, properties: { type: 'object' }, changed: { type: 'array', maxItems: 2 }, verified: { type: 'boolean' } },
        required: ['reference', 'componentReference', 'properties', 'changed', 'verified'],
    }, 'POST', ['skeletal', 'animation', 'configure', 'scene'])
    async skeletalAnimationConfigure(args: { reference: IInstanceReference, properties: Partial<Record<SkeletalField, boolean>> }) {
        if (!args?.reference?.id || typeof args.reference.id !== 'string') invalid('reference.id is required.');
        if (!args.properties || typeof args.properties !== 'object' || Array.isArray(args.properties)) invalid('properties must contain at least one supported field.');
        const keys = Object.keys(args.properties);
        if (!keys.length || keys.length > SKELETAL_FIELDS.length || keys.some((key) => !(SKELETAL_FIELDS as readonly string[]).includes(key))) {
            throw new ToolError({ code: 'UNSUPPORTED_PROPERTY', status: 422, message: 'Only playOnLoad and useBakedAnimation are supported serialized SkeletalAnimation fields.' });
        }
        for (const key of keys) if (typeof (args.properties as any)[key] !== 'boolean') invalid(`${key} must be a boolean.`);
        const node = await queryNode(args.reference.id);
        const components = nodeComponents(node);
        const index = components.findIndex((component) => componentType(component) === 'cc.SkeletalAnimation' || componentType(component) === 'SkeletalAnimation');
        if (index < 0) throw new ToolError({ code: 'UNSUPPORTED_COMPONENT', status: 422, message: `Node ${args.reference.id} has no serialized cc.SkeletalAnimation component.` });
        const component = components[index];
        const values = component?.value && typeof component.value === 'object' ? component.value : {};
        const previous: Record<string, unknown> = {};
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(values, key)) throw new ToolError({ code: 'UNSUPPORTED_PROPERTY', status: 422, message: `SkeletalAnimation does not expose serialized field ${key}.` });
            previous[key] = clone(values[key]);
        }
        const componentReference = { id: componentId(component) ?? `${args.reference.id}:component:${index}`, type: componentType(component) || 'cc.SkeletalAnimation' };
        const attempted: string[] = [];
        try {
            for (const key of keys) {
                attempted.push(key);
                const result = await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: `__comps__.${index}.${key}`, dump: { value: (args.properties as any)[key], type: 'Boolean' } });
                if (result === false) throw new Error(`set-property refused ${key}`);
            }
            await Editor.Message.request('scene', 'snapshot');
            const readBackNode = await queryNode(args.reference.id);
            const readBackComponent = nodeComponents(readBackNode)[index];
            const readBackValues = readBackComponent?.value ?? {};
            for (const key of keys) if (unwrap(readBackValues[key]) !== (args.properties as any)[key]) throw new Error(`read-back mismatch for ${key}`);
            const readBackProperties: Record<string, boolean> = {};
            for (const key of keys) readBackProperties[key] = unwrap(readBackValues[key]) as boolean;
            return { reference: { id: args.reference.id, type: args.reference.type ?? 'cc.Node' }, componentReference, properties: readBackProperties, changed: keys, verified: true };
        } catch (error) {
            try {
                for (const key of attempted) {
                    const result = await Editor.Message.request('scene', 'set-property', { uuid: args.reference.id, path: `__comps__.${index}.${key}`, dump: previous[key] as any });
                }
                await Editor.Message.request('scene', 'snapshot');
                const rollbackNode = await queryNode(args.reference.id);
                const rollbackValues = nodeComponents(rollbackNode)[index]?.value ?? {};
                for (const key of attempted) if (JSON.stringify(rollbackValues[key]) !== JSON.stringify(previous[key])) throw new Error(`rollback read-back mismatch for ${key}`);
            } catch (rollbackError) {
                throw new ToolError({ code: 'ROLLBACK_FAILED', status: 500, message: `SkeletalAnimation configuration failed and node ${args.reference.id} could not be restored.`, details: { cause: error instanceof Error ? error.message : String(error), rollback: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) } });
            }
            throw new ToolError({ code: 'MUTATION_FAILED', status: 502, message: `SkeletalAnimation configuration failed for node ${args.reference.id}.`, details: { cause: error instanceof Error ? error.message : String(error) } });
        }
    }

    @utcpTool(
        'terrainCreate',
        'Create a bounded Terrain asset and attach a cc.Terrain component with serialized read-back.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                assetPath: { type: 'string', pattern: '^db://assets/[A-Za-z0-9._/-]+$' },
                name: { type: 'string', minLength: 1, maxLength: 128 },
                parentReference: InstanceReferenceSchema,
            },
            required: ['assetPath', 'name'],
        },
        {
            type: 'object',
            properties: {
                asset: { type: 'object' },
                node: { type: 'object' },
                component: { type: 'object' },
                verified: { type: 'boolean', const: true },
            },
            required: ['asset', 'node', 'component', 'verified'],
        },
        'POST',
        ['terrain', 'create', 'scene', 'asset', 'compound'],
    )
    async terrainCreate(args: { assetPath: string, name: string, parentReference?: IInstanceReference }): Promise<Record<string, unknown>> {
        if (!ASSET_PATH_PATTERN.test(args.assetPath)) invalid('assetPath must be a project-local db://assets path');
        if (!args.name.trim()) invalid('name must not be empty');
        let asset: { reference: IInstanceReference };
        try {
            asset = await new AssetTools().assetCreate({ assetPath: args.assetPath, preset: 'terrain' });
        } catch (error) {
            throw new ToolError({
                code: 'UNSUPPORTED_EDITOR_API',
                status: 422,
                message: 'Creator 3.7.3 does not expose a usable native Terrain asset preset.',
                details: { cause: error instanceof Error ? error.message : String(error), preset: 'terrain' },
                recovery: 'Provide a Creator version with a native terrain preset or import a supported terrain asset first.',
            });
        }
        const parent = args.parentReference?.id ?? (await Editor.Message.request('scene', 'query-node-tree') as any)?.uuid;
        if (typeof parent !== 'string' || !parent) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: 'Scene root is unavailable for terrain creation.' });
        const created = await Editor.Message.request('scene', 'create-node', { name: args.name, parent });
        const nodeId = Array.isArray(created) ? created[0] : created;
        if (typeof nodeId !== 'string' || !nodeId) throw new ToolError({ code: 'CREATE_FAILED', status: 502, message: 'Creator did not return a terrain node identity.' });
        try {
            await Editor.Message.request('scene', 'create-component', { uuid: nodeId, component: 'cc.Terrain' });
            await Editor.Message.request('scene', 'snapshot');
            const node = await Editor.Message.request('scene', 'query-node', nodeId) as any;
            const component = (node?.__comps__ ?? []).find((item: any) => String(item.type ?? item.value?.__type__?.value ?? item.value?.__type__ ?? item.cid) === 'cc.Terrain');
            if (!component) throw new Error('cc.Terrain read-back was missing after creation');
            return { asset, node: { id: nodeId, type: 'cc.Node' }, component: { id: component.value?.uuid?.value ?? component.uuid, type: 'cc.Terrain' }, verified: true };
        } catch (error) {
            await Editor.Message.request('scene', 'remove-node', { uuid: nodeId }).catch(() => undefined);
            throw new ToolError({ code: 'CREATE_FAILED', status: 502, message: `Terrain creation failed for ${args.name}.`, details: { cause: error instanceof Error ? error.message : String(error) }, recovery: 'Use a Creator version exposing cc.Terrain scene creation and serialized read-back.' });
        }
    }

    @utcpTool('modelImportConfigure', 'Configure one typed model importer property.', { type: 'object', additionalProperties: false, properties: { reference: InstanceReferenceSchema, path: { type: 'string' }, value: {} }, required: ['reference', 'path', 'value'] }, { type: 'object' }, 'POST', ['model', 'import', 'configure'])
    async modelImportConfigure(args: any) { const asset = await info(args.reference); if (!/fbx|gltf|model/i.test(String(asset.importer ?? ''))) throw new ToolError({ code: 'TYPE_MISMATCH', status: 422, message: 'Reference is not a model asset.' }); return new AssetTools().assetImportSettingsSet(args); }
}
