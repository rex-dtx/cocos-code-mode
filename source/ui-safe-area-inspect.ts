import { buildUiLayoutReport, LayoutReport, Aabb, Point } from './ui-layout-report';

export interface SafeAreaRect extends Aabb { }
export interface SafeAreaInsets { top: number; right: number; bottom: number; left: number }
export interface UiSafeAreaInspectRequest {
    root?: { id?: string; type?: string };
    rootPath?: string;
    safeArea: { rect?: SafeAreaRect; insets?: SafeAreaInsets; x?: number; y?: number; width?: number; height?: number };
    maxNodes?: number;
    maxIssues?: number;
}

export interface SafeAreaNode {
    uuid: string;
    path: string;
    name: string;
    active: boolean;
    bounds: Aabb;
    inside: boolean;
    overlaps: boolean;
    outside: boolean;
}

export interface SafeAreaIssue {
    code: 'SAFE_AREA_OUTSIDE' | 'SAFE_AREA_CLIPPED';
    severity: 'error' | 'warning';
    nodeId: string;
    message: string;
    evidence: { bounds: Aabb; safeArea: SafeAreaRect; overlap: Aabb | null };
}

export interface UiSafeAreaInspectReport {
    complete: boolean;
    valid: boolean;
    safeArea: { rect: SafeAreaRect; insets?: SafeAreaInsets };
    root: { uuid: string; path: string; name: string };
    checkedNodes: number;
    nodes: SafeAreaNode[];
    issues: SafeAreaIssue[];
    truncation: Array<{ kind: 'nodes' | 'issues'; limit: number; omitted?: number; reason: string }>;
    truncated: boolean;
}

export interface UiSafeAreaInspectError {
    error: { code: string; message: string; evidence: Record<string, unknown> };
}

export type UiSafeAreaInspectResult = UiSafeAreaInspectReport | UiSafeAreaInspectError;

const DEFAULT_MAX_NODES = 128;
const DEFAULT_MAX_ISSUES = 256;
const MAX_LIMIT = 5000;
const EPSILON = 1e-6;

function error(code: string, message: string, evidence: Record<string, unknown> = {}): UiSafeAreaInspectError {
    return { error: { code, message, evidence } };
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function validLimit(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_LIMIT) return null;
    return value as number;
}

function validRect(value: unknown): value is SafeAreaRect {
    const rect = value as Partial<SafeAreaRect> | null;
    return !!rect && finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height)
        && rect.width > 0 && rect.height > 0;
}

function validInsets(value: unknown): value is SafeAreaInsets {
    const insets = value as Partial<SafeAreaInsets> | null;
    return !!insets && finite(insets.top) && finite(insets.right) && finite(insets.bottom) && finite(insets.left)
        && insets.top >= 0 && insets.right >= 0 && insets.bottom >= 0 && insets.left >= 0;
}

function intersection(a: Aabb, b: Aabb): Aabb | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function contained(a: Aabb, b: Aabb): boolean {
    return a.x >= b.x - EPSILON && a.y >= b.y - EPSILON
        && a.x + a.width <= b.x + b.width + EPSILON
        && a.y + a.height <= b.y + b.height + EPSILON;
}

export function normalizedSafeArea(request: UiSafeAreaInspectRequest, rootBounds: Aabb): { rect: SafeAreaRect; insets?: SafeAreaInsets } | UiSafeAreaInspectError {
    const value = request.safeArea;
    if (!value || typeof value !== 'object') return error('UI_SAFE_AREA_INVALID_INPUT', 'safeArea must be a rectangle or insets object');
    const inlineRect = ('x' in value || 'y' in value || 'width' in value || 'height' in value)
        ? { x: value.x, y: value.y, width: value.width, height: value.height } : undefined;
    const hasRect = value.rect !== undefined || inlineRect !== undefined;
    const hasInsets = value.insets !== undefined;
    if (hasRect === hasInsets) return error('UI_SAFE_AREA_INVALID_INPUT', 'safeArea must provide exactly one rectangle or insets value');
    if (hasRect) {
        const rect = value.rect ?? inlineRect;
        if (!validRect(rect)) return error('UI_SAFE_AREA_INVALID_INPUT', 'safeArea rectangle must have finite positive x, y, width, and height', { safeArea: value });
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }
    if (!validInsets(value.insets)) return error('UI_SAFE_AREA_INVALID_INPUT', 'safeArea insets must be finite and non-negative', { safeArea: value });
    const insets = { ...value.insets };
    const width = rootBounds.width - insets.left - insets.right;
    const height = rootBounds.height - insets.top - insets.bottom;
    if (!(width > 0) || !(height > 0)) return error('UI_SAFE_AREA_INVALID_INPUT', 'safeArea insets exceed the selected root bounds', { insets, rootBounds });
    return { rect: { x: rootBounds.x + insets.left, y: rootBounds.y + insets.top, width, height }, insets };
}

export function buildUiSafeAreaInspect(sceneRoot: Parameters<typeof buildUiLayoutReport>[0], request: UiSafeAreaInspectRequest): UiSafeAreaInspectResult {
    const maxNodes = validLimit(request?.maxNodes, DEFAULT_MAX_NODES);
    const maxIssues = validLimit(request?.maxIssues, DEFAULT_MAX_ISSUES);
    if (maxNodes === null || maxIssues === null) return error('UI_SAFE_AREA_INVALID_INPUT', 'maxNodes and maxIssues must be integers from 1 to 5000', { maxNodes: request?.maxNodes, maxIssues: request?.maxIssues });
    if (!request?.root?.id && !request?.rootPath) return error('UI_SAFE_AREA_ROOT_REQUIRED', 'A root id or rootPath is required');
    const layout = buildUiLayoutReport(sceneRoot, {
        root: request.root,
        rootPath: request.rootPath,
        designResolution: { width: 1000000000, height: 1000000000 },
        viewport: { width: 1000000000, height: 1000000000 },
        fitMode: 'none',
        maxNodes: Math.min(maxNodes + 1, MAX_LIMIT),
        diagnostics: false,
        maxIssues: MAX_LIMIT,
    });
    if ('error' in layout) {
        const code = layout.error.code === 'UI_LAYOUT_ROOT_NOT_FOUND' ? 'UI_SAFE_AREA_ROOT_NOT_FOUND'
            : layout.error.code === 'UI_LAYOUT_ROOT_NOT_UI' ? 'UI_SAFE_AREA_ROOT_NOT_UI' : 'UI_SAFE_AREA_INVALID_INPUT';
        return error(code, layout.error.message, layout.error.evidence);
    }
    const rootNode = layout.nodes.find((node) => node.uuid === layout.root.uuid);
    if (!rootNode) return error('UI_SAFE_AREA_ROOT_NOT_FOUND', 'Selected root has no measurable UI geometry', { root: layout.root });
    const safeArea = normalizedSafeArea(request, rootNode.designAabb);
    if ('error' in safeArea) return safeArea;

    const nodes: SafeAreaNode[] = layout.nodes
        .filter((node) => node.uuid !== layout.root.uuid)
        .map((node) => {
            const overlaps = intersection(node.designAabb, safeArea.rect);
            const inside = contained(node.designAabb, safeArea.rect);
            return {
                uuid: node.uuid,
                path: node.path,
                name: node.name,
                active: node.active,
                bounds: { ...node.designAabb },
                inside,
                overlaps: overlaps !== null,
                outside: !inside,
            };
        });
    const issues: SafeAreaIssue[] = [];
    for (const node of nodes) {
        if (!node.active || node.inside) continue;
        const overlap = intersection(node.bounds, safeArea.rect);
        issues.push({
            code: overlap ? 'SAFE_AREA_CLIPPED' : 'SAFE_AREA_OUTSIDE',
            severity: overlap ? 'warning' : 'error',
            nodeId: node.uuid,
            message: overlap ? 'Active UI bounds cross the safe-area boundary' : 'Active UI bounds lie outside the safe area',
            evidence: { bounds: node.bounds, safeArea: safeArea.rect, overlap },
        });
    }
    const truncation: Array<{ kind: 'nodes' | 'issues'; limit: number; omitted?: number; reason: string }> = layout.truncation.filter((item) => item.kind === 'nodes').map((item) => ({ kind: 'nodes', limit: maxNodes, omitted: item.omitted, reason: 'safe-area node limit reached' }));
    if (issues.length > maxIssues) {
        const omitted = issues.length - maxIssues;
        issues.length = maxIssues;
        truncation.push({ kind: 'issues', limit: maxIssues, omitted, reason: 'safe-area issue limit reached' });
    }
    const complete = layout.complete && truncation.length === 0;
    return {
        complete,
        valid: complete && issues.length === 0,
        safeArea,
        root: layout.root,
        checkedNodes: nodes.length,
        nodes,
        issues,
        truncation,
        truncated: !complete,
    };
}
