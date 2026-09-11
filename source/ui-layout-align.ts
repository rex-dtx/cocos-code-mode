export interface LayoutAlignRect {
    id: string;
    position: { x: number, y: number, z: number };
    worldRect: { x: number, y: number, width: number, height: number };
}

export type LayoutAlignOperation = 'align' | 'distribute';
export type LayoutAlignAxis = 'horizontal' | 'vertical';
export type LayoutAlignEdge = 'left' | 'right' | 'center' | 'top' | 'bottom' | 'middle';

export interface LayoutAlignmentUpdate {
    id: string;
    position: LayoutAlignRect['position'];
}

export function calculateLayoutAlignment(
    items: LayoutAlignRect[],
    operation: LayoutAlignOperation,
    axis: LayoutAlignAxis,
    edge?: LayoutAlignEdge,
): LayoutAlignmentUpdate[] {
    if (items.length < (operation === 'align' ? 2 : 3)) {
        throw new Error(`${operation} requires at least ${operation === 'align' ? 2 : 3} nodes`);
    }
    if (operation === 'align') return calculateAlign(items, axis, edge);
    return calculateDistribute(items, axis);
}

function calculateAlign(items: LayoutAlignRect[], axis: LayoutAlignAxis, requestedEdge?: LayoutAlignEdge): LayoutAlignmentUpdate[] {
    const edge = requestedEdge ?? (axis === 'horizontal' ? 'left' : 'bottom');
    const valid = axis === 'horizontal' ? ['left', 'right', 'center'] : ['top', 'bottom', 'middle'];
    if (!valid.includes(edge)) throw new Error(`edge ${edge} is incompatible with ${axis} alignment`);

    const target = edge === 'left'
        ? Math.min(...items.map((item) => item.worldRect.x))
        : edge === 'right'
            ? Math.max(...items.map((item) => item.worldRect.x + item.worldRect.width))
            : edge === 'top'
                ? Math.max(...items.map((item) => item.worldRect.y + item.worldRect.height))
                : edge === 'bottom'
                    ? Math.min(...items.map((item) => item.worldRect.y))
                    : items.reduce((sum, item) => sum + (axis === 'horizontal'
                        ? item.worldRect.x + item.worldRect.width / 2
                        : item.worldRect.y + item.worldRect.height / 2), 0) / items.length;

    return items.map((item) => {
        const current = axis === 'horizontal'
            ? edge === 'left' ? item.worldRect.x : edge === 'right' ? item.worldRect.x + item.worldRect.width : item.worldRect.x + item.worldRect.width / 2
            : edge === 'top' ? item.worldRect.y + item.worldRect.height : edge === 'bottom' ? item.worldRect.y : item.worldRect.y + item.worldRect.height / 2;
        const delta = target - current;
        return { id: item.id, position: { ...item.position, [axis === 'horizontal' ? 'x' : 'y']: item.position[axis === 'horizontal' ? 'x' : 'y'] + delta } };
    });
}

function calculateDistribute(items: LayoutAlignRect[], axis: LayoutAlignAxis): LayoutAlignmentUpdate[] {
    const sorted = [...items].sort((left, right) => axis === 'horizontal'
        ? left.worldRect.x - right.worldRect.x
        : left.worldRect.y - right.worldRect.y);
    const first = sorted[0].worldRect;
    const last = sorted[sorted.length - 1].worldRect;
    const start = axis === 'horizontal' ? first.x : first.y;
    const end = axis === 'horizontal' ? last.x + last.width : last.y + last.height;
    const size = sorted.reduce((sum, item) => sum + (axis === 'horizontal' ? item.worldRect.width : item.worldRect.height), 0);
    const gap = (end - start - size) / (sorted.length - 1);
    let cursor = start;
    return sorted.map((item) => {
        const currentStart = axis === 'horizontal' ? item.worldRect.x : item.worldRect.y;
        const delta = cursor - currentStart;
        cursor += (axis === 'horizontal' ? item.worldRect.width : item.worldRect.height) + gap;
        return { id: item.id, position: { ...item.position, [axis === 'horizontal' ? 'x' : 'y']: item.position[axis === 'horizontal' ? 'x' : 'y'] + delta } };
    });
}

