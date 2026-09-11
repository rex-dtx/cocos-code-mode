import { buildUiLayoutReport, LayoutIssue, LayoutReport, LayoutReportNode, FitMode, Aabb } from './ui-layout-report';
import { normalizedSafeArea, SafeAreaInsets, SafeAreaRect } from './ui-safe-area-inspect';

export type UiLayoutValidateCheck = 'clipping' | 'overlap' | 'anchors' | 'safeArea';
export interface UiLayoutValidateChecks {
    clipping?: boolean;
    overlap?: boolean;
    anchors?: boolean;
    safeArea?: boolean;
}
export interface UiLayoutValidateRequest {
    root?: { id?: string; type?: string };
    rootPath?: string;
    designResolution?: { width: number; height: number };
    viewport?: { width: number; height: number };
    fitMode?: FitMode;
    safeArea?: { rect?: SafeAreaRect; insets?: SafeAreaInsets; x?: number; y?: number; width?: number; height?: number };
    maxNodes?: number;
    maxIssues?: number;
    checks?: UiLayoutValidateChecks;
}

export interface UiLayoutValidateReport {
    complete: boolean;
    valid: boolean;
    truncated: boolean;
    checkedNodes: number;
    root: LayoutReport['root'];
    nodes: LayoutReportNode[];
    issues: LayoutIssue[];
    truncation: LayoutReport['truncation'];
    geometry?: Pick<LayoutReport, 'designResolution' | 'viewport' | 'fitMode' | 'fit'>;
    safeArea?: { rect: SafeAreaRect; insets?: SafeAreaInsets };
}
export interface UiLayoutValidateError {
    error: { code: string; message: string; evidence: Record<string, unknown> };
}
export type UiLayoutValidateResult = UiLayoutValidateReport | UiLayoutValidateError;

const DEFAULT_MAX_NODES = 128;
const DEFAULT_MAX_ISSUES = 256;
const MAX_LIMIT = 5000;
const SAFE_AREA_COORDINATE_LIMIT = 1_000_000_000;
const CHECKS: UiLayoutValidateCheck[] = ['clipping', 'overlap', 'anchors', 'safeArea'];
const FIT_MODES: FitMode[] = ['fitWidth', 'fitHeight', 'contain', 'cover', 'stretch', 'none'];

function error(code: string, message: string, evidence: Record<string, unknown> = {}): UiLayoutValidateError {
    return { error: { code, message, evidence } };
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validLimit(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIMIT ? value as number : null;
}
function validSize(value: unknown): value is { width: number; height: number } {
    const size = value as { width?: unknown; height?: unknown } | null;
    return !!size && finite(size.width) && finite(size.height) && size.width > 0 && size.height > 0;
}
function intersection(a: Aabb, b: Aabb): Aabb | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
function contains(a: Aabb, b: Aabb): boolean {
    return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}
function checksFor(request: UiLayoutValidateRequest): Set<UiLayoutValidateCheck> | UiLayoutValidateError {
    const value = request.checks;
    if (value === undefined) return new Set(request.safeArea ? CHECKS : CHECKS.filter((check) => check !== 'safeArea'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'checks must be an object of boolean flags', { checks: value });
    for (const key of Object.keys(value)) {
        if (!CHECKS.includes(key as UiLayoutValidateCheck) || typeof (value as Record<string, unknown>)[key] !== 'boolean') {
            return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'checks contains an unknown key or non-boolean value', { checks: value });
        }
    }
    const result = new Set<UiLayoutValidateCheck>();
    for (const check of CHECKS) if (value[check] === true) result.add(check);
    if (result.has('safeArea') && !request.safeArea) return error('UI_LAYOUT_VALIDATE_SAFE_AREA_REQUIRED', 'safeArea check requires safeArea options', {});
    return result;
}
function isCandidateRequest(request: unknown): request is UiLayoutValidateRequest {
    return !!request && typeof request === 'object' && ('root' in request || 'rootPath' in request || 'designResolution' in request || 'viewport' in request || 'safeArea' in request || 'checks' in request);
}

function selectedIssues(report: LayoutReport, selected: Set<UiLayoutValidateCheck>, safeArea: { rect: SafeAreaRect; insets?: SafeAreaInsets } | undefined): LayoutIssue[] {
    const issues: LayoutIssue[] = [];
    for (const item of report.issues) {
        const clipping = item.code === 'CLIPPED_BY_ANCESTOR' || item.code === 'OFF_SCREEN';
        const overlap = item.code === 'OVERLAP';
        const anchor = item.code === 'ANCHOR_OUT_OF_RANGE' || item.code === 'ANCHOR_MISSING';
        if ((clipping && selected.has('clipping')) || (overlap && selected.has('overlap')) || (anchor && selected.has('anchors'))) issues.push(item);
    }
    if (selected.has('anchors')) {
        for (const node of report.nodes) {
            if (!node.active || node.anchorProvided) continue;
            issues.push({
                code: 'ANCHOR_MISSING',
                severity: 'warning',
                nodeId: node.uuid,
                message: 'UITransform does not expose an anchor point',
                evidence: { anchor: null, defaultedAnchor: node.anchor },
            });
        }
    }
    if (!safeArea || !selected.has('safeArea')) return issues;
    const rootId = report.root.uuid;
    for (const node of report.nodes) {
        if (!node.active || node.uuid === rootId) continue;
        const overlap = intersection(node.designAabb, safeArea.rect);
        if (contains(node.designAabb, safeArea.rect)) continue;
        const code = overlap ? 'SAFE_AREA_CLIPPED' : 'SAFE_AREA_OUTSIDE';
        issues.push({
            code,
            severity: overlap ? 'warning' : 'error',
            nodeId: node.uuid,
            message: overlap ? 'Active UI bounds cross the safe-area boundary' : 'Active UI bounds lie outside the safe area',
            evidence: { bounds: node.designAabb, safeArea: safeArea.rect, overlap },
        });
        const widget = node.constraints.widget as Record<string, unknown> | undefined;
        if (widget && Object.values(widget).some((value) => value === true)) {
            issues.push({
                code: 'SAFE_AREA_CONSTRAINT_INCONSISTENT', severity: 'warning', nodeId: node.uuid,
                message: 'Active Widget constraints place UI bounds outside the selected safe area',
                evidence: { bounds: node.designAabb, safeArea: safeArea.rect, widget },
            });
        }
    }
    return issues;
}

export function buildUiLayoutValidate(sceneRoot: Parameters<typeof buildUiLayoutReport>[0], request: UiLayoutValidateRequest): UiLayoutValidateResult {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'Request must be an object', { request });
    const maxNodes = validLimit(request.maxNodes, DEFAULT_MAX_NODES);
    const maxIssues = validLimit(request.maxIssues, DEFAULT_MAX_ISSUES);
    if (maxNodes === null || maxIssues === null) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'maxNodes and maxIssues must be integers from 1 to 5000', { maxNodes: request.maxNodes, maxIssues: request.maxIssues });
    const hasId = typeof request.root?.id === 'string' && request.root.id.length > 0;
    const hasPath = typeof request.rootPath === 'string' && request.rootPath.length > 0;
    if (hasId === hasPath) return error(hasId ? 'UI_LAYOUT_VALIDATE_INVALID_INPUT' : 'UI_LAYOUT_VALIDATE_ROOT_REQUIRED', hasId ? 'Specify exactly one of root.id or rootPath' : 'A root id or rootPath is required', { root: request.root, rootPath: request.rootPath });
    if (request.root && (!hasId || (request.root.type !== undefined && typeof request.root.type !== 'string'))) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'root must contain a non-empty string id and optional string type', { root: request.root });
    const hasDesign = request.designResolution !== undefined || request.viewport !== undefined;
    if (hasDesign && (!validSize(request.designResolution) || !validSize(request.viewport))) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'designResolution and viewport must both be provided with finite positive dimensions', { designResolution: request.designResolution, viewport: request.viewport });
    if (!hasDesign && !request.safeArea) return error('UI_LAYOUT_VALIDATE_GEOMETRY_REQUIRED', 'Provide designResolution and viewport or safeArea options', {});
    if (request.fitMode !== undefined && !FIT_MODES.includes(request.fitMode)) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', 'fitMode is not supported', { fitMode: request.fitMode });
    const checks = checksFor(request);
    if ('error' in checks) return checks;
    const layout = buildUiLayoutReport(sceneRoot, {
        root: request.root,
        rootPath: request.rootPath,
        designResolution: request.designResolution ?? { width: SAFE_AREA_COORDINATE_LIMIT, height: SAFE_AREA_COORDINATE_LIMIT },
        viewport: request.viewport ?? { width: SAFE_AREA_COORDINATE_LIMIT, height: SAFE_AREA_COORDINATE_LIMIT },
        fitMode: request.fitMode ?? (hasDesign ? 'contain' : 'none'),
        maxNodes,
        maxIssues: MAX_LIMIT,
        diagnostics: true,
    });
    if ('error' in layout) return error(layout.error.code.replace('UI_LAYOUT_', 'UI_LAYOUT_VALIDATE_'), layout.error.message, layout.error.evidence);
    const rootNode = layout.nodes.find((node) => node.uuid === layout.root.uuid);
    if (!rootNode) return error('UI_LAYOUT_VALIDATE_ROOT_NOT_FOUND', 'Selected root has no measurable UI geometry', { root: layout.root });
    let safeArea: { rect: SafeAreaRect; insets?: SafeAreaInsets } | undefined;
    if (request.safeArea) {
        const normalized = normalizedSafeArea({ root: request.root, rootPath: request.rootPath, safeArea: request.safeArea }, rootNode.designAabb);
        if ('error' in normalized) return error('UI_LAYOUT_VALIDATE_INVALID_INPUT', normalized.error.message, normalized.error.evidence);
        safeArea = normalized;
    }
    const issues = selectedIssues(layout, checks, safeArea);
    const truncation = layout.truncation.map((item) => ({ ...item, reason: item.kind === 'nodes' ? 'layout validation node limit reached' : 'layout validation issue limit reached' }));
    if (issues.length > maxIssues) {
        truncation.push({ kind: 'issues', limit: maxIssues, omitted: issues.length - maxIssues, reason: 'layout validation issue limit reached' });
        issues.length = maxIssues;
    }
    const complete = layout.complete && truncation.length === 0;
    return {
        complete,
        valid: complete && !issues.some((item) => item.severity === 'error' || item.severity === 'warning'),
        truncated: !complete,
        checkedNodes: layout.nodes.length,
        root: layout.root,
        nodes: layout.nodes,
        issues,
        truncation,
        geometry: { designResolution: layout.designResolution, viewport: layout.viewport, fitMode: layout.fitMode, fit: layout.fit },
        ...(safeArea ? { safeArea } : {}),
    };
}

export { isCandidateRequest };
