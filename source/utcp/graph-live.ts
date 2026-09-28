import fs from 'fs';
import path from 'path';
import { SceneTools } from './tools/scene-tools';
import { ToolError } from './tool-error';

export interface GraphLiveSnapshot {
    bundle: string | null;
    snapshot: Record<string, unknown> | null;
}

export function assertLiveTreeComplete(tree: unknown, expectedNodes: number): number {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned no node tree for the active scene.' });
    }
    const stack: unknown[] = [tree];
    const nodeIds = new Set<string>();
    let count = 0;
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a malformed node entry in the active scene tree.' });
        }
        const node = current as Record<string, unknown>;
        const reference = node.reference as Record<string, unknown> | undefined;
        if (typeof reference?.id !== 'string' || reference.id.length === 0) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a scene node without an authoritative UUID.' });
        }
        if (nodeIds.has(reference.id)) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned duplicate scene node UUIDs.' });
        }
        nodeIds.add(reference.id);
        count++;
        if (count > 10000) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The active scene tree exceeds the 10,000-node capture limit.' });
        }
        if (node.truncated) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator marked the active scene tree as truncated.', details: { reason: node.truncated, nodeUuid: reference.id } });
        }
        if (typeof node.childrenOmitted === 'number' && node.childrenOmitted > 0) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator omitted scene descendants from the active tree.', details: { omitted: node.childrenOmitted, nodeUuid: reference.id } });
        }
        if (node.children !== undefined && !Array.isArray(node.children)) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a malformed children collection.', details: { nodeUuid: reference.id } });
        }
        if (node.components !== undefined && !Array.isArray(node.components)) {
            throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a malformed component collection.', details: { nodeUuid: reference.id } });
        }
        for (const child of (node.children ?? []) as unknown[]) stack.push(child);
        for (const component of (node.components ?? []) as unknown[]) {
            if (!component || typeof component !== 'object' || Array.isArray(component)) {
                throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a malformed scene component.', details: { nodeUuid: reference.id } });
            }
            const componentReference = (component as Record<string, unknown>).reference as Record<string, unknown> | undefined;
            if (typeof componentReference?.id !== 'string' || !componentReference.id || typeof componentReference.type !== 'string' || !componentReference.type) {
                throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator returned a scene component without authoritative identity or type.', details: { nodeUuid: reference.id } });
            }
        }
    }
    if (count !== expectedNodes) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The bounded tree count does not match the current scene metadata.', details: { expectedNodes, capturedNodes: count } });
    }
    return count;
}

export interface GraphSceneInfo { dirty: boolean; nodeCount: number; uuid?: string; currentScene?: { uuid?: string } }

export async function captureCurrentSceneGraph(project: string, selectedBundle?: string): Promise<GraphLiveSnapshot> {
    let info: GraphSceneInfo;
    try {
        info = await new SceneTools().sceneGetInfo();
    } catch (error) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Could not verify the active Creator scene before building a live overlay.', details: { cause: error instanceof Error ? error.message : String(error) }, recovery: 'Check that a scene is open and Creator scene IPC is responsive, then retry.' });
    }
    if (typeof info.dirty !== 'boolean' || !Number.isInteger(info.nodeCount)) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'Creator did not return authoritative scene dirty state and node count.' });
    }
    const sceneUuid = info.currentScene?.uuid ?? info.uuid;
    if (typeof sceneUuid !== 'string' || !sceneUuid) return { bundle: null, snapshot: null };

    let assetPath: unknown;
    let assetInfo: unknown;
    try {
        [assetPath, assetInfo] = await Promise.all([
            Editor.Message.request('asset-db', 'query-path', sceneUuid),
            Editor.Message.request('asset-db', 'query-asset-info', sceneUuid),
        ]);
    } catch (error) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The active scene UUID could not be resolved through Creator asset-db.', details: { sceneUuid, cause: error instanceof Error ? error.message : String(error) } });
    }
    if (typeof assetPath !== 'string' || !assetPath || !path.isAbsolute(assetPath)) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The active scene UUID has no authoritative filesystem path.', details: { sceneUuid, assetPath: assetPath ?? null } });
    }
    const asset = assetInfo && typeof assetInfo === 'object' ? assetInfo as Record<string, unknown> : null;
    if (asset?.uuid !== sceneUuid || asset.type !== 'cc.SceneAsset') {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The current asset-db path is not an authoritative scene asset for the active scene UUID.', details: { sceneUuid, assetUuid: asset?.uuid ?? null, type: asset?.type ?? null } });
    }

    let realProject: string;
    let realScene: string;
    try {
        realProject = fs.realpathSync(project);
        realScene = fs.realpathSync(assetPath);
        if (!fs.statSync(realScene).isFile()) throw new Error('active scene path is not a file');
    } catch (error) {
        throw new ToolError({ code: 'GRAPH_PATH_INVALID', status: 400, message: 'The current scene path cannot be resolved inside the active project.', details: { cause: error instanceof Error ? error.message : String(error) } });
    }
    const relativeScene = path.relative(realProject, realScene);
    const portable = relativeScene.split(path.sep).join('/');
    const parts = portable.split('/');
    const bundle = parts[0] === 'assets' && parts.length >= 3 ? parts[1] : '';
    const insideProject = relativeScene !== '' && !relativeScene.startsWith('..') && !path.isAbsolute(relativeScene);
    if (!insideProject || !/^assets\/[^/]+\/.+\.scene$/i.test(portable) || !bundle) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The current scene must resolve to a project-local assets/<bundle>/*.scene file.', details: { sceneUuid, relativeScene: portable } });
    }
    if (selectedBundle && selectedBundle !== bundle) {
        throw new ToolError({ code: 'GRAPH_LIVE_INCOMPLETE', status: 422, message: 'The active scene belongs to a different bundle than the requested live overlay.', details: { selectedBundle, sceneBundle: bundle, sceneUuid } });
    }

    const tree = await new SceneTools().nodeGetTree({ verbose: true, maxDepth: 99, maxNodes: 10000 });
    const count = assertLiveTreeComplete(tree, info.nodeCount);
    return { bundle, snapshot: { sourceFile: portable, tree, dirty: info.dirty, capturedNodes: count } };
}
