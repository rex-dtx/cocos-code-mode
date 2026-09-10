import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import fs from 'fs-extra';
import path from 'path';
import { createHash } from 'crypto';

interface ComponentRecord { type?: string; cid?: string; value?: Record<string, any>; }
interface NodeRecord { uuid?: string; name?: any; children?: NodeRecord[]; __comps__?: ComponentRecord[]; }

async function sceneNodes(rootUuid?: string): Promise<NodeRecord[]> {
    const tree = (rootUuid ? await Editor.Message.request('scene', 'query-node-tree', rootUuid) : await Editor.Message.request('scene', 'query-node-tree')) as unknown as NodeRecord | null;
    if (!tree) throw new ToolError({ code: 'NOT_FOUND', status: 404, message: 'Scene subtree not found' });
    const result: NodeRecord[] = [];
    const visit = async (node: NodeRecord): Promise<void> => {
        if (result.length >= 128 || !node.uuid) return;
        const dump = await Editor.Message.request('scene', 'query-node', node.uuid) as unknown as NodeRecord | null;
        if (!dump) return;
        result.push(dump);
        for (const child of node.children ?? []) await visit(child);
    };
    await visit(tree);
    return result;
}

function nodeName(node: NodeRecord): string { return typeof node.name === 'string' ? node.name : node.name?.value ?? node.uuid ?? ''; }
function componentType(component: ComponentRecord): string {
    return component.type ?? component.value?.__type__?.value ?? component.value?.__type__ ?? component.cid ?? component.value?.cid ?? '';
}
function componentTypes(node: NodeRecord): string[] { return (node.__comps__ ?? []).map(componentType).filter(Boolean); }
function audioProperties(component: ComponentRecord): Record<string, unknown> { return component.value ?? {}; }
function propertyValue(value: unknown): unknown {
    if (!value || typeof value !== 'object' || !('value' in value)) return value;
    return value.value;
}
async function hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
    });
    return hash.digest('hex');
}

export class ExpansionTools {
    @utcpTool('particleInspect', 'Inspect bounded particle system components and serialized configuration.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { systems: { type: 'array' }, count: { type: 'integer' } }, required: ['systems', 'count'] }, 'GET', ['particle', 'inspect'])
    async particleInspect(args: { reference?: IInstanceReference }): Promise<{ systems: Array<Record<string, unknown>>, count: number }> {

        const nodes = await sceneNodes(args.reference?.id);
        const systems = nodes.flatMap((node) => (node.__comps__ ?? [])
            .filter((component) => /cc\.ParticleSystem(?:2D)?$/.test(componentType(component)))
            .map((component) => ({ node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), type: componentType(component), properties: component.value ?? {} })));
        return { systems, count: systems.length };
    }
    @utcpTool('terrainInspect', 'Inspect bounded Terrain components and their asset/effect configuration.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { terrains: { type: 'array' }, count: { type: 'integer' } }, required: ['terrains', 'count'] }, 'GET', ['terrain', 'inspect'])
    async terrainInspect(args: { reference?: IInstanceReference }): Promise<{ terrains: Array<Record<string, unknown>>, count: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const terrains = nodes.flatMap((node) => (node.__comps__ ?? [])
            .filter((component) => componentType(component) === 'cc.Terrain')
            .map((component) => ({ node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), properties: component.value ?? {} })));
        return { terrains, count: terrains.length };
    }
    @utcpTool('localizationInspect', 'Inspect bounded Creator localization runtime availability, languages and text direction.', { type: 'object', properties: {} }, { type: 'object', properties: { supported: { type: 'boolean' }, currentLanguage: { type: ['string', 'null'] }, languages: { type: 'array' }, directions: { type: 'object' }, error: { type: 'string' } }, required: ['supported', 'currentLanguage', 'languages', 'directions'] }, 'GET', ['localization', 'inspect'])
    async localizationInspect(): Promise<{ supported: boolean, currentLanguage: string | null, languages: string[], directions: Record<string, string>, error?: string }> {
        return await Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'inspectLocalization', args: [] }) as any;
    }

    @utcpTool('particleValidate', 'Validate bounded particle system presence and serialized component configuration.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'issues', 'checkedNodes'] }, 'GET', ['particle', 'validate'])
    async particleValidate(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, issues: string[], checkedNodes: number }> {
        const result = await this.particleInspect(args);
        const issues = result.systems.length === 0 ? ['no particle system component found'] : [];
        return { valid: issues.length === 0, issues, checkedNodes: result.count };
    }

    @utcpTool('physics2dInspect', 'Inspect bounded 2D physics bodies and colliders in the open scene.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { nodes: { type: 'array' }, count: { type: 'integer' } }, required: ['nodes', 'count'] }, 'GET', ['physics', '2d', 'inspect'])
    async physics2dInspect(args: { reference?: IInstanceReference }): Promise<{ nodes: Array<Record<string, unknown>>, count: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const rows = nodes.map((node) => ({ node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), components: componentTypes(node).filter((type) => /RigidBody2D|Collider2D|Joint2D|PhysicsSystem2D/.test(type)) })).filter((row) => row.components.length > 0);
        return { nodes: rows, count: rows.length };
    }

    @utcpTool('physics2dValidate', 'Validate incomplete 2D rigid-body and collider combinations.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'issues', 'checkedNodes'] }, 'GET', ['physics', '2d', 'validate'])
    async physics2dValidate(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, issues: string[], checkedNodes: number }> {
        const rows = await this.physics2dInspect(args);
        const issues: string[] = [];
        for (const row of rows.nodes) {
            const components = row.components as string[];
            if (components.some((type) => type === 'cc.RigidBody2D') && !components.some((type) => type.includes('Collider2D'))) issues.push(`${row.name}: rigid body has no 2D collider`);
        }
        return { valid: issues.length === 0, issues, checkedNodes: rows.count };
    }

    @utcpTool('physics2dTopologyAudit', 'Audit bounded 2D physics body, collider and joint topology without assuming a backend.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, nodes: { type: 'array' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'nodes', 'issues', 'checkedNodes'] }, 'GET', ['physics', '2d', 'topology', 'audit'])
    async physics2dTopologyAudit(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, nodes: Array<Record<string, unknown>>, issues: string[], checkedNodes: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const issues: string[] = [];
        const topology = nodes.map((node) => {
            const types = componentTypes(node);
            const bodies = types.filter((type) => type === 'cc.RigidBody2D');
            const colliders = types.filter((type) => /Collider2D$/.test(type));
            const joints = types.filter((type) => /Joint2D$/.test(type));
            if (bodies.length > 0 && colliders.length === 0) issues.push(`${nodeName(node)}: rigid body has no collider`);
            if (joints.length > 0 && bodies.length === 0) issues.push(`${nodeName(node)}: joint has no rigid body on the same node`);
            return { node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), bodies, colliders, joints };
        }).filter((row) => row.bodies.length > 0 || row.colliders.length > 0 || row.joints.length > 0);
        return { valid: issues.length === 0, nodes: topology, issues, checkedNodes: topology.length };
    }

    @utcpTool(
        'physics2dCompatibilityAudit',
        'Validate bounded 2D physics components against an explicit Creator backend capability matrix.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                backend: { type: 'string', enum: ['builtin', 'box2d'], description: 'Target Creator 2D physics backend.' },
                reference: InstanceReferenceSchema,
            },
            required: ['backend'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                valid: { type: 'boolean' },
                backend: { type: 'string', enum: ['builtin', 'box2d'] },
                nodes: { type: 'array' },
                issues: { type: 'array', items: { type: 'string' } },
                checkedNodes: { type: 'integer' },
            },
            required: ['valid', 'backend', 'nodes', 'issues', 'checkedNodes'],
        },
        'GET',
        ['physics', '2d', 'compatibility', 'backend', 'audit']
    )
    async physics2dCompatibilityAudit(args: { backend: 'builtin' | 'box2d', reference?: IInstanceReference }): Promise<{ valid: boolean, backend: 'builtin' | 'box2d', nodes: Array<Record<string, unknown>>, issues: string[], checkedNodes: number }> {
        const topology = await this.physics2dTopologyAudit({ reference: args.reference });
        const issues = [...topology.issues];
        if (args.backend === 'builtin') {
            for (const row of topology.nodes) {
                const bodies = row.bodies as string[];
                const joints = row.joints as string[];
                if (bodies.length > 0) issues.push(`${row.name}: ${bodies.join(', ')} requires the box2d backend`);
                if (joints.length > 0) issues.push(`${row.name}: ${joints.join(', ')} requires the box2d backend`);
            }
        }
        return { valid: issues.length === 0, backend: args.backend, nodes: topology.nodes, issues, checkedNodes: topology.checkedNodes };
    }
    @utcpTool('physics3dInspect', 'Inspect bounded 3D rigid bodies, colliders, materials and joints in the open scene.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { nodes: { type: 'array' }, count: { type: 'integer' } }, required: ['nodes', 'count'] }, 'GET', ['physics', '3d', 'inspect'])
    async physics3dInspect(args: { reference?: IInstanceReference }): Promise<{ nodes: Array<Record<string, unknown>>, count: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const rows = nodes.map((node) => ({ node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), components: componentTypes(node).filter((type) => /RigidBody$|Collider$|Joint$|PhysicsSystem/.test(type)) })).filter((row) => row.components.length > 0);
        return { nodes: rows, count: rows.length };
    }
    @utcpTool('physics3dTopologyAudit', 'Audit bounded 3D rigid body, collider, joint and physics-system topology.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, nodes: { type: 'array' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'nodes', 'issues', 'checkedNodes'] }, 'GET', ['physics', '3d', 'topology', 'audit'])
    async physics3dTopologyAudit(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, nodes: Array<Record<string, unknown>>, issues: string[], checkedNodes: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const issues: string[] = [];
        const topology = nodes.map((node) => {
            const types = componentTypes(node);
            const bodies = types.filter((type) => /RigidBody$/.test(type));
            const colliders = types.filter((type) => /Collider$/.test(type));
            const joints = types.filter((type) => /Joint$/.test(type));
            const systems = types.filter((type) => /PhysicsSystem/.test(type));
            if (joints.length > 0 && bodies.length === 0) issues.push(`${nodeName(node)}: joint has no rigid body on the same node`);
            return { node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), bodies, colliders, joints, systems };
        }).filter((row) => row.bodies.length > 0 || row.colliders.length > 0 || row.joints.length > 0 || row.systems.length > 0);
        return { valid: issues.length === 0, nodes: topology, issues, checkedNodes: topology.length };
    }
    @utcpTool('physics3dValidate', 'Validate bounded 3D physics topology and report missing collider/body relationships.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, checkedNodes: { type: 'integer' } }, required: ['valid', 'issues', 'checkedNodes'] }, 'GET', ['physics', '3d', 'validate'])
    async physics3dValidate(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, issues: string[], checkedNodes: number }> {
        const result = await this.physics3dTopologyAudit(args);
        const issues = [...result.issues];
        for (const row of result.nodes) {
            const bodies = row.bodies as string[];
            const colliders = row.colliders as string[];
            if (bodies.length > 0 && colliders.length === 0) issues.push(`${row.name}: rigid body has no 3D collider`);
        }
        return { valid: issues.length === 0, issues, checkedNodes: result.checkedNodes };
    }

    @utcpTool('audioSourceInspect', 'Inspect bounded AudioSource components and normalized clip/playback properties.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { sources: { type: 'array' }, count: { type: 'integer' } }, required: ['sources', 'count'] }, 'GET', ['audio', 'inspect', 'source'])
    async audioSourceInspect(args: { reference?: IInstanceReference }): Promise<{ sources: Array<Record<string, unknown>>, count: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const sources = nodes.flatMap((node) => (node.__comps__ ?? []).filter((component) => componentType(component) === 'cc.AudioSource').map((component) => ({ node: { id: node.uuid, type: 'cc.Node' }, name: nodeName(node), properties: audioProperties(component) })));
        return { sources, count: sources.length };
    }
    @utcpTool('audioSourceAudit', 'Audit bounded AudioSource clip and playback compatibility with normalized properties.', { type: 'object', properties: { reference: InstanceReferenceSchema } }, { type: 'object', properties: { valid: { type: 'boolean' }, sources: { type: 'array' }, issues: { type: 'array' }, checkedSources: { type: 'integer' } }, required: ['valid', 'sources', 'issues', 'checkedSources'] }, 'GET', ['audio', 'source', 'audit', 'compatibility'])
    async audioSourceAudit(args: { reference?: IInstanceReference }): Promise<{ valid: boolean, sources: Array<Record<string, unknown>>, issues: string[], checkedSources: number }> {
        const nodes = await sceneNodes(args.reference?.id);
        const issues: string[] = [];
        const sources = nodes.flatMap((node) => (node.__comps__ ?? []).filter((component) => componentType(component) === 'cc.AudioSource').map((component) => {
            const props = component.value ?? {};
            const clip = propertyValue(props.clip);
            const volume = propertyValue(props.volume);
            const loop = propertyValue(props.loop);
            const playOnAwake = propertyValue(props.playOnAwake);
            const name = nodeName(node);
            if (clip === null || clip === undefined || clip === '') issues.push(`${name}: missing clip`);
            if (typeof volume !== 'number' || volume < 0 || volume > 1) issues.push(`${name}: volume must be between 0 and 1`);
            return { node: { id: node.uuid, type: 'cc.Node' }, name, clip, volume, loop, playOnAwake };
        }));
        return { valid: issues.length === 0, sources, issues, checkedSources: sources.length };
    }

    @utcpTool('audioAssetValidate', 'Validate one audio asset importer/type and return bounded compatibility findings.', { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, importer: { type: 'string' }, type: { type: 'string' }, issues: { type: 'array' } }, required: ['valid', 'importer', 'type', 'issues'] }, 'GET', ['audio', 'asset', 'validate'])
    async audioAssetValidate(args: { reference: IInstanceReference }): Promise<{ valid: boolean, importer: string, type: string, issues: string[] }> {
        const info: any = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
        if (!info) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Asset ${args.reference.id} not found` });
        const issues: string[] = [];
        if (!/audio|clip|sound/i.test(String(info.type ?? '')) && !/audio|sound/i.test(String(info.importer ?? ''))) issues.push('asset importer/type is not recognized as audio');
        return { valid: issues.length === 0, importer: info.importer ?? '', type: info.type ?? '', issues };
    }
    @utcpTool('assetImporterAudit', 'Audit one asset importer with normalized source identity, settings and bounded compatibility findings.', { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, { type: 'object', properties: { valid: { type: 'boolean' }, importer: { type: 'string' }, settings: { type: 'object' }, source: { type: 'object' }, issues: { type: 'array' } }, required: ['valid', 'importer', 'settings', 'source', 'issues'] }, 'GET', ['asset', 'importer', 'audit'])
    async assetImporterAudit(args: { reference: IInstanceReference }): Promise<{ valid: boolean, importer: string, settings: Record<string, unknown>, source: Record<string, unknown>, issues: string[] }> {
        const info: any = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
        if (!info) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Asset ${args.reference.id} not found` });
        const importer = String(info.importer ?? '');
        const settings = (info.importerSettings ?? info.meta ?? {}) as Record<string, unknown>;
        const source = { uuid: info.uuid, url: info.url, type: info.type, name: info.name, isDirectory: Boolean(info.isDirectory) };
        const issues: string[] = [];
        if (!importer) issues.push('asset has no importer');
        if (source.isDirectory) issues.push('asset reference resolves to a directory');
        return { valid: issues.length === 0, importer, settings, source, issues };
    }
    @utcpTool('localizationValidate', 'Validate a bounded list of localization keys in the current Creator language.', { type: 'object', properties: { keys: { type: 'array', maxItems: 256, items: { type: 'string', minLength: 1 } } }, required: ['keys'] }, { type: 'object', properties: { supported: { type: 'boolean' }, language: { type: ['string', 'null'] }, checkedKeys: { type: 'integer' }, missingKeys: { type: 'array' }, error: { type: 'string' } }, required: ['supported', 'language', 'checkedKeys', 'missingKeys'] }, 'GET', ['localization', 'validate', 'keys'])
    async localizationValidate(args: { keys: string[] }): Promise<{ supported: boolean, language: string | null, checkedKeys: number, missingKeys: string[], error?: string }> {
        return await Editor.Message.request('scene', 'execute-scene-script', { name: 'cc-bridge-3x', method: 'validateLocalization', args: [args.keys] }) as any;
    }

    @utcpTool('buildPresetValidate', 'Validate bounded build options before dispatching a Creator build task.', { type: 'object', properties: { options: { type: 'object' } }, required: ['options'] }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, platform: { type: 'string' } }, required: ['valid', 'issues', 'platform'] }, 'POST', ['build', 'preset', 'validate'])
    async buildPresetValidate(args: { options: Record<string, unknown> }): Promise<{ valid: boolean, issues: string[], platform: string }> {
        const platform = typeof args.options.platform === 'string' ? args.options.platform : '';
        const issues: string[] = [];
        if (!platform) issues.push('options.platform is required');
        if (typeof args.options.buildPath === 'string' && args.options.buildPath.length > 512) issues.push('options.buildPath exceeds 512 characters');
        return { valid: issues.length === 0, issues, platform };
    }

    @utcpTool('buildArtifactInspect', 'Inspect a bounded project-local build artifact file inventory with byte sizes.', { type: 'object', properties: { artifactPath: { type: 'string' }, maxFiles: { type: 'integer', minimum: 1, maximum: 256, default: 64 } }, required: ['artifactPath'] }, { type: 'object', properties: { exists: { type: 'boolean' }, files: { type: 'array' }, count: { type: 'integer' } }, required: ['exists', 'files', 'count'] }, 'GET', ['build', 'artifact', 'inspect'])
    async buildArtifactInspect(args: { artifactPath: string, maxFiles?: number }): Promise<{ exists: boolean, files: Array<Record<string, unknown>>, count: number }> {
        const projectRoot = path.resolve((Editor.Project as any).path);
        const target = path.resolve(projectRoot, args.artifactPath);
        if (!target.startsWith(projectRoot + path.sep) && target !== projectRoot) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath must remain inside the project' });
        const stat = await fs.stat(target).catch(() => null);
        if (!stat) return { exists: false, files: [], count: 0 };
        const files: Array<Record<string, unknown>> = [];
        const walk = async (current: string): Promise<void> => {
            if (files.length >= Math.min(args.maxFiles ?? 64, 256)) return;
            const currentStat = await fs.stat(current);
            if (currentStat.isDirectory()) { for (const entry of await fs.readdir(current)) await walk(path.join(current, entry)); }
            else files.push({ path: path.relative(projectRoot, current).replace(/\\/g, '/'), bytes: currentStat.size });
        };
        await walk(target);
        return { exists: true, files, count: files.length };
    }
    @utcpTool('buildOutputAudit', 'Verify bounded build output files, byte sizes and SHA-256 hashes against an expected manifest.', {
        type: 'object',
        properties: {
            artifactPath: { type: 'string' },
            expectedFiles: { type: 'array', maxItems: 256, items: { type: 'object', properties: { path: { type: 'string' }, sha256: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } }, required: ['path'] } },
        },
        required: ['artifactPath', 'expectedFiles'],
    }, { type: 'object', properties: { valid: { type: 'boolean' }, issues: { type: 'array' }, files: { type: 'array' }, checkedFiles: { type: 'integer' } }, required: ['valid', 'issues', 'files', 'checkedFiles'] }, 'GET', ['build', 'output', 'audit', 'hash'])
    async buildOutputAudit(args: { artifactPath: string, expectedFiles: Array<{ path: string, sha256?: string }> }): Promise<{ valid: boolean, issues: string[], files: Array<Record<string, unknown>>, checkedFiles: number }> {
        const projectRoot = path.resolve((Editor.Project as any).path);
        const artifactRoot = path.resolve(projectRoot, args.artifactPath);
        const artifactRelative = path.relative(projectRoot, artifactRoot);
        if (artifactRelative.startsWith('..') || path.isAbsolute(artifactRelative)) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'artifactPath must remain inside the project' });
        const issues: string[] = [];
        const files: Array<Record<string, unknown>> = [];
        for (const expected of args.expectedFiles.slice(0, 256)) {
            const target = path.resolve(artifactRoot, expected.path);
            const targetRelative = path.relative(artifactRoot, target);
            if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) {
                issues.push(`outside-artifact:${expected.path}`);
                continue;
            }
            const stat = await fs.stat(target).catch(() => null);
            if (!stat?.isFile()) {
                issues.push(`missing:${expected.path}`);
                continue;
            }
            const sha256 = await hashFile(target);
            const row = { path: path.relative(projectRoot, target).replace(/\\/g, '/'), bytes: stat.size, sha256 };
            files.push(row);
            if (expected.sha256 && expected.sha256.toLowerCase() !== sha256) issues.push(`hash-mismatch:${expected.path}`);
        }
        return { valid: issues.length === 0 && files.length === args.expectedFiles.slice(0, 256).length, issues, files, checkedFiles: files.length };
    }
}
