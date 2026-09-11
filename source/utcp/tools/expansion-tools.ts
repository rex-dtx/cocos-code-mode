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

    @utcpTool(
        'physics2dCreateBody',
        'Create one verified Box2D rigid-body node with a bounded collider choice, snapshot, read-back, and rollback on failure.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                backend: { type: 'string', enum: ['builtin', 'box2d'] },
                collider: { type: 'string', enum: ['box', 'circle'], default: 'box' },
                name: { type: 'string', minLength: 1, maxLength: 128, default: 'Physics2DBody' },
                parentReference: InstanceReferenceSchema,
            },
            required: ['backend'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                reference: InstanceReferenceSchema,
                backend: { type: 'string', enum: ['box2d'] },
                bodyType: { type: 'string' },
                colliderType: { type: 'string' },
                components: { type: 'array', items: { type: 'string' } },
            },
            required: ['reference', 'backend', 'bodyType', 'colliderType', 'components'],
        },
        'POST',
        ['physics', '2d', 'create', 'body', 'collider', 'compound']
    )
    async physics2dCreateBody(args: { backend: 'builtin' | 'box2d', collider?: 'box' | 'circle', name?: string, parentReference?: IInstanceReference }): Promise<{ reference: IInstanceReference, backend: 'box2d', bodyType: string, colliderType: string, components: string[] }> {
        if (args.backend !== 'box2d') {
            throw new ToolError({
                code: 'UNSUPPORTED_BACKEND',
                status: 422,
                message: 'physics2dCreateBody requires the box2d backend; Creator Builtin provides collision detection without rigid bodies.',
                recovery: 'Select the box2d backend or create collider-only nodes with the ordinary component tools.',
            });
        }
        const colliderType = args.collider === 'circle' ? 'cc.CircleCollider2D' : 'cc.BoxCollider2D';
        let nodeUuid: string | undefined;
        try {
            let parentUuid = args.parentReference?.id;
            if (parentUuid) {
                const parent = await Editor.Message.request('scene', 'query-node', parentUuid);
                if (!parent) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Parent node ${parentUuid} not found` });
            } else {
                const root = await Editor.Message.request('scene', 'query-node-tree') as unknown as NodeRecord | null;
                parentUuid = root?.uuid;
                if (!parentUuid) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: 'Open scene root not found' });
            }
            const created = await Editor.Message.request('scene', 'create-node', { name: args.name ?? 'Physics2DBody', parent: parentUuid });
            nodeUuid = Array.isArray(created) ? created[0] : created;
            if (typeof nodeUuid !== 'string' || !nodeUuid) throw new Error('Creator did not return a node UUID');
            await Editor.Message.request('scene', 'create-component', { uuid: nodeUuid, component: 'cc.RigidBody2D' });
            await Editor.Message.request('scene', 'create-component', { uuid: nodeUuid, component: colliderType });
            await Editor.Message.request('scene', 'snapshot');
            const dump = await Editor.Message.request('scene', 'query-node', nodeUuid) as unknown as NodeRecord | null;
            const components = dump ? componentTypes(dump) : [];
            if (!dump || !components.includes('cc.RigidBody2D') || !components.includes(colliderType)) {
                throw new Error(`Creator read-back did not contain cc.RigidBody2D and ${colliderType}`);
            }
            return {
                reference: { id: nodeUuid, type: 'cc.Node' },
                backend: 'box2d',
                bodyType: 'cc.RigidBody2D',
                colliderType,
                components,
            };
        } catch (error) {
            if (nodeUuid) {
                try {
                    await Editor.Message.request('scene', 'remove-node', { uuid: nodeUuid });
                    await Editor.Message.request('scene', 'snapshot');
                } catch (rollbackError) {
                    throw new ToolError({
                        code: 'ROLLBACK_FAILED',
                        status: 500,
                        message: `physics2dCreateBody failed and node ${nodeUuid} could not be rolled back`,
                        details: { cause: error instanceof Error ? error.message : String(error), rollback: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
                        recovery: `Delete node ${nodeUuid} manually before retrying.`,
                    });
                }
            }
            throw error;
        }
    }

    @utcpTool(
        'physics2dCreateJoint',
        'Create one verified Box2D 2D joint between two existing rigid-body nodes with endpoint validation and rollback.',
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                backend: { type: 'string', enum: ['builtin', 'box2d'] },
                joint: { type: 'string', enum: ['distance', 'spring', 'hinge', 'slider', 'fixed'], default: 'distance' },
                bodyReference: InstanceReferenceSchema,
                connectedBodyReference: InstanceReferenceSchema,
            },
            required: ['backend', 'bodyReference', 'connectedBodyReference'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                backend: { type: 'string', enum: ['box2d'] },
                jointReference: InstanceReferenceSchema,
                bodyReference: InstanceReferenceSchema,
                connectedBodyReference: InstanceReferenceSchema,
                jointType: { type: 'string' },
            },
            required: ['backend', 'jointReference', 'bodyReference', 'connectedBodyReference', 'jointType'],
        },
        'POST',
        ['physics', '2d', 'create', 'joint', 'compound']
    )
    async physics2dCreateJoint(args: { backend: 'builtin' | 'box2d', joint?: 'distance' | 'spring' | 'hinge' | 'slider' | 'fixed', bodyReference: IInstanceReference, connectedBodyReference: IInstanceReference }): Promise<{ backend: 'box2d', jointReference: IInstanceReference, bodyReference: IInstanceReference, connectedBodyReference: IInstanceReference, jointType: string }> {
        if (args.backend !== 'box2d') {
            throw new ToolError({
                code: 'UNSUPPORTED_BACKEND',
                status: 422,
                message: 'physics2dCreateJoint requires the box2d backend; Creator Builtin does not support 2D joints.',
                recovery: 'Select the box2d backend or omit the joint and use collider-only nodes.',
            });
        }
        if (args.bodyReference.id === args.connectedBodyReference.id) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'A 2D joint requires two distinct rigid-body nodes' });
        }
        const body = await Editor.Message.request('scene', 'query-node', args.bodyReference.id) as unknown as NodeRecord | null;
        const connected = await Editor.Message.request('scene', 'query-node', args.connectedBodyReference.id) as unknown as NodeRecord | null;
        if (!body) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Body node ${args.bodyReference.id} not found` });
        if (!connected) throw new ToolError({ code: 'TARGET_NOT_FOUND', status: 404, message: `Connected body node ${args.connectedBodyReference.id} not found` });
        const componentUuid = (component: ComponentRecord): string | undefined => component.value?.uuid?.value ?? component.value?.uuid ?? component.cid ?? component.value?.cid;
        const bodyComponent = body.__comps__?.find((component) => componentType(component) === 'cc.RigidBody2D');
        const connectedBodyComponent = connected.__comps__?.find((component) => componentType(component) === 'cc.RigidBody2D');
        if (!bodyComponent) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `Body node ${args.bodyReference.id} has no cc.RigidBody2D` });
        if (!connectedBodyComponent) throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `Connected body node ${args.connectedBodyReference.id} has no cc.RigidBody2D` });
        const connectedBodyUuid = componentUuid(connectedBodyComponent);
        if (!connectedBodyUuid) throw new ToolError({ code: 'POSTCONDITION_FAILED', status: 500, message: `Connected body ${args.connectedBodyReference.id} has no serialized component UUID` });
        const jointType = ({
            distance: 'cc.DistanceJoint2D',
            spring: 'cc.SpringJoint2D',
            hinge: 'cc.HingeJoint2D',
            slider: 'cc.SliderJoint2D',
            fixed: 'cc.FixedJoint2D',
        } as const)[args.joint ?? 'distance'];
        let jointUuid: string | undefined;
        const containsUuid = (value: unknown, uuid: string): boolean => {
            if (value === uuid) return true;
            if (!value || typeof value !== 'object') return false;
            return Object.values(value as Record<string, unknown>).some((item) => containsUuid(item, uuid));
        };
        try {
            await Editor.Message.request('scene', 'create-component', { uuid: args.bodyReference.id, component: jointType });
            const afterCreate = await Editor.Message.request('scene', 'query-node', args.bodyReference.id) as unknown as NodeRecord | null;
            const joint = afterCreate?.__comps__?.find((component) => componentType(component) === jointType);
            jointUuid = joint ? componentUuid(joint) : undefined;
            if (!jointUuid) throw new Error(`Creator did not return the ${jointType} component UUID`);
            const jointIndex = afterCreate?.__comps__?.findIndex((component) => componentType(component) === jointType) ?? -1;
            const setResult = await Editor.Message.request('scene', 'set-property', {
                uuid: args.bodyReference.id,
                path: `_components.${jointIndex}.connectedBody`,
                dump: { value: { uuid: connectedBodyUuid }, type: 'cc.RigidBody2D' },
            });
            if (setResult === false) throw new Error(`Creator refused connectedBody assignment for ${jointType}`);
            await Editor.Message.request('scene', 'snapshot');
            const verified = await Editor.Message.request('scene', 'query-node', args.bodyReference.id) as unknown as NodeRecord | null;
            const verifiedJoint = verified?.__comps__?.find((component) => componentType(component) === jointType);
            if (!verifiedJoint || !containsUuid(verifiedJoint.value, connectedBodyUuid)) {
                throw new Error(`Creator read-back did not verify ${jointType}.connectedBody`);
            }
            return {
                backend: 'box2d',
                jointReference: { id: jointUuid, type: jointType },
                bodyReference: args.bodyReference,
                connectedBodyReference: args.connectedBodyReference,
                jointType,
            };
        } catch (error) {
            if (jointUuid) {
                try {
                    await Editor.Message.request('scene', 'remove-component', { uuid: jointUuid });
                    await Editor.Message.request('scene', 'snapshot');
                } catch (rollbackError) {
                    throw new ToolError({
                        code: 'ROLLBACK_FAILED',
                        status: 500,
                        message: `physics2dCreateJoint failed and joint ${jointUuid} could not be rolled back`,
                        details: { cause: error instanceof Error ? error.message : String(error), rollback: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) },
                        recovery: `Remove component ${jointUuid} manually before retrying.`,
                    });
                }
            }
            throw error;
        }
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
