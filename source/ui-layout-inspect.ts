import { aabbFromCorners, localCorners, transformCorners, Aabb, Point } from './ui-layout-report';

export interface UiLayoutGeometryRequest { nodeIds: string[] }
export interface UiLayoutGeometry {
    id: string;
    size: { width: number; height: number } | null;
    anchor: Point | null;
    worldRect: Aabb | null;
}
interface LiveNode {
    uuid?: string;
    children?: LiveNode[];
    worldMatrix?: unknown;
    getComponent?: (type: string) => unknown;
}
interface GeometryError { error: { code: string; message: string } }
export type UiLayoutGeometryResult = { nodes: UiLayoutGeometry[] } | GeometryError;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finiteFields<K extends string>(value: unknown, keys: K[]): value is Record<K, number> {
    return record(value) && keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

/** Validate the finite scene-script response before publishing any geometry. */
export function isUiLayoutGeometry(value: unknown, id: string): value is UiLayoutGeometry {
    if (!record(value) || value.id !== id) return false;
    const { size, anchor, worldRect } = value;
    return (size === null || finiteFields(size, ['width', 'height']))
        && (anchor === null || finiteFields(anchor, ['x', 'y']))
        && (worldRect === null || (size !== null && anchor !== null
            && finiteFields(worldRect, ['x', 'y', 'width', 'height'])
            && worldRect.width >= 0 && worldRect.height >= 0));
}

/** Read only the requested nodes' own UITransform, never descendant-inclusive bounds. */
export function buildUiLayoutInspectGeometry(scene: LiveNode, request: UiLayoutGeometryRequest): UiLayoutGeometryResult {
    if (!record(request) || Object.keys(request).some((key) => key !== 'nodeIds')
        || !Array.isArray(request.nodeIds) || request.nodeIds.length < 1 || request.nodeIds.length > 128
        || request.nodeIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256)
        || new Set(request.nodeIds).size !== request.nodeIds.length) {
        return { error: { code: 'INVALID_ARGUMENT', message: 'Geometry requires 1..128 unique non-empty node IDs of at most 256 characters.' } };
    }
    const remaining = new Set(request.nodeIds);
    const found = new Map<string, LiveNode>();
    const visited = new Set<LiveNode>();
    const stack = [scene];
    while (stack.length && remaining.size) {
        const node = stack.pop()!;
        if (!node || visited.has(node)) continue;
        visited.add(node);
        if (node.uuid && remaining.delete(node.uuid)) found.set(node.uuid, node);
        for (let index = (node.children?.length ?? 0) - 1; index >= 0; index--) stack.push(node.children![index]);
    }
    if (remaining.size) return { error: { code: 'NOT_FOUND', message: `Live UI node ${remaining.values().next().value} not found.` } };

    const nodes: UiLayoutGeometry[] = [];
    for (const id of request.nodeIds) {
        const node = found.get(id)!;
        try {
            if (typeof node.getComponent !== 'function') throw new Error('Live node has no component reader.');
            const transform = node.getComponent('cc.UITransform');
            if (transform === null || transform === undefined) {
                nodes.push({ id, size: null, anchor: null, worldRect: null });
                continue;
            }
            if (!record(transform)) throw new Error('Malformed live UITransform.');
            const contentSize = transform.contentSize;
            const anchorPoint = transform.anchorPoint;
            if (!finiteFields(contentSize, ['width', 'height']) || !finiteFields(anchorPoint, ['x', 'y'])) {
                throw new Error('Live UITransform size or anchor is unavailable or non-finite.');
            }
            // The engine getter updates world transforms, including ancestors outside the selected subtree.
            const matrix = node.worldMatrix;
            if (!finiteFields(matrix, ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15'])) {
                throw new Error('Live worldMatrix is unavailable or non-finite.');
            }
            const size = { width: contentSize.width, height: contentSize.height };
            const anchor = { x: anchorPoint.x, y: anchorPoint.y };
            const worldRect = aabbFromCorners(transformCorners(localCorners(size, anchor), matrix));
            const geometry = { id, size, anchor, worldRect };
            if (!isUiLayoutGeometry(geometry, id)) throw new Error('Live geometry exceeds finite numeric range.');
            nodes.push(geometry);
        } catch (error: unknown) {
            return { error: { code: 'UI_LAYOUT_GEOMETRY_UNAVAILABLE', message: `Cannot inspect geometry for ${id}: ${error instanceof Error ? error.message : String(error)}` } };
        }
    }
    return { nodes };
}
