export type FitMode = 'fitWidth' | 'fitHeight' | 'contain' | 'cover' | 'stretch' | 'none';
export type IssueSeverity = 'error' | 'warning' | 'info' | 'advisory';

export interface Point { x: number; y: number }
export interface Aabb { x: number; y: number; width: number; height: number }
export interface LayoutMatrix { m00: number; m01: number; m02: number; m03: number; m04: number; m05: number; m06: number; m07: number; m08: number; m09: number; m10: number; m11: number; m12: number; m13: number; m14: number; m15: number }
export interface FitTransform { scale: Point; offset: Point; designResolution: { width: number; height: number }; viewport: { width: number; height: number }; mode: FitMode }

export interface LayoutReportRequest {
    root?: { id?: string; type?: string };
    rootPath?: string;
    designResolution: { width: number; height: number };
    viewport: { width: number; height: number };
    fitMode?: FitMode;
    maxNodes?: number;
    maxIssues?: number;
    maxBytes?: number;
    overlay?: boolean;
    alignmentTolerance?: number;
    gapTolerance?: number;
}

interface LiveComponent { type?: string; [key: string]: any }
interface LiveNode {
    uuid?: string;
    name?: string;
    active?: boolean;
    activeInHierarchy?: boolean;
    children?: LiveNode[];
    parent?: LiveNode | null;
    components?: any[];
    worldMatrix?: any;
    position?: any;
    scale?: any;
    rotation?: any;
    eulerAngles?: any;
    skewX?: number;
    skewY?: number;
    [key: string]: any;
}

export interface LayoutIssue {
    code: string;
    severity: IssueSeverity;
    nodeId?: string;
    relatedNodeId?: string;
    message: string;
    evidence: Record<string, any>;
}

export interface LayoutReportNode {
    uuid: string;
    path: string;
    name: string;
    active: boolean;
    siblingIndex: number;
    components: string[];
    localTransform: Record<string, any>;
    worldMatrix: LayoutMatrix;
    worldCorners: Point[];
    designAabb: Aabb;
    screenCorners: Point[];
    screenAabb: Aabb;
    anchor: Point;
    size: { width: number; height: number };
    constraints: Record<string, any>;
}

export interface LayoutOverlayArtifact {
    mimeType: 'image/png';
    encoding: 'base64';
    data: string;
    byteLength: number;
    width: number;
    height: number;
    scale: Point;
}

export interface LayoutOverlayError {
    code: string;
    message: string;
    evidence: Record<string, any>;
}

export interface LayoutOverlayStatus {
    requested: boolean;
    valid: boolean;
    rendered: boolean;
    cleaned: boolean;
    maxArtifactBytes: number;
    maxResponseBytes: number;
    responseBytes: number;
    sourceNodeCount: number;
    sourceIssueCount: number;
    artifact?: LayoutOverlayArtifact;
    error?: LayoutOverlayError;
    dirtyBefore?: boolean;
    dirtyAfter?: boolean;
    dirtyPreserved?: boolean;
}

export interface LayoutReport {
    complete: boolean;
    designResolution: { width: number; height: number };
    viewport: { width: number; height: number };
    fitMode: FitMode;
    fit: FitTransform;
    root: { uuid: string; path: string; name: string };
    nodes: LayoutReportNode[];
    issues: LayoutIssue[];
    truncation: Array<{ kind: 'nodes' | 'issues' | 'bytes'; limit: number; omitted?: number; reason: string }>;
    overlay: LayoutOverlayStatus;
    tolerances: { alignment: number; gap: number };
}

export interface LayoutReportError {
    error: {
        code: string;
        message: string;
        evidence: Record<string, unknown>;
    };
}

export type LayoutReportResult = LayoutReport | LayoutReportError;

const DEFAULT_MAX_NODES = 128;
const DEFAULT_MAX_ISSUES = 256;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_LIMIT = 5000;
const MAX_OVERLAY_BYTES = 256 * 1024;
const MAX_OVERLAY_DIMENSION = 2048;
const MAX_OVERLAY_PIXELS = 1024 * 1024;

function num(value: any, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function point(value: any): Point { return { x: num(value?.x), y: num(value?.y) }; }
function unwrap(value: any): any { return value && typeof value === 'object' && 'value' in value ? value.value : value; }
function componentType(component: any): string {
    const runtimeName = (() => {
        try {
            return (globalThis as any).cc?.js?.getClassName?.(component);
        } catch {
            return undefined;
        }
    })();
    const candidates = [
        runtimeName,
        component?.__classname__,
        component?._className,
        component?.constructor?.name,
        typeof component?.type === 'string' ? component.type : undefined,
    ];
    return String(candidates.find((value) => typeof value === 'string' && value.length > 0 && value !== 'Object') ?? 'cc.Component');
}
function componentBaseName(component: any): string {
    return componentType(component).replace(/^cc\./, '');
}
function componentsOf(node: LiveNode): LiveComponent[] { return Array.isArray(node.components) ? node.components : []; }
function componentNamed(node: LiveNode, name: string): LiveComponent | undefined {
    const expected = name.replace(/^cc\./, '');
    return componentsOf(node).find((component) => componentBaseName(component) === expected || component?.name === name);
}
function readProperty(component: any, ...names: string[]): any {
    for (const name of names) {
        const value = unwrap(component?.[name]);
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

export function extractMatrix(value: any): LayoutMatrix {
    const result: any = {};
    const keys = ['m00', 'm01', 'm02', 'm03', 'm04', 'm05', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15'];
    for (const key of keys) result[key] = num(value?.[key], key === 'm00' || key === 'm05' || key === 'm10' || key === 'm15' ? 1 : 0);
    return result as LayoutMatrix;
}

export function localCorners(size: { width: number; height: number }, anchor: Point): Point[] {
    const left = -size.width * anchor.x;
    const bottom = -size.height * anchor.y;
    return [{ x: left, y: bottom }, { x: left + size.width, y: bottom }, { x: left + size.width, y: bottom + size.height }, { x: left, y: bottom + size.height }];
}

export function transformCorners(corners: Point[], matrix: LayoutMatrix): Point[] {
    return corners.map(({ x, y }) => ({ x: x * matrix.m00 + y * matrix.m04 + matrix.m12, y: x * matrix.m01 + y * matrix.m05 + matrix.m13 }));
}

export function aabbFromCorners(corners: Point[]): Aabb {
    if (!corners.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function resolveFit(designResolution: { width: number; height: number }, viewport: { width: number; height: number }, mode: FitMode = 'contain'): FitTransform {
    const dw = designResolution.width; const dh = designResolution.height;
    if (!(dw > 0) || !(dh > 0) || !(viewport.width > 0) || !(viewport.height > 0)) throw new Error('designResolution and viewport dimensions must be positive');
    let sx = viewport.width / dw; let sy = viewport.height / dh;
    if (mode === 'fitWidth') sy = sx;
    else if (mode === 'fitHeight') sx = sy;
    else if (mode === 'contain') sx = sy = Math.min(sx, sy);
    else if (mode === 'cover') sx = sy = Math.max(sx, sy);
    else if (mode === 'none') sx = sy = 1;
    return { scale: { x: sx, y: sy }, offset: { x: (viewport.width - dw * sx) / 2, y: (viewport.height - dh * sy) / 2 }, designResolution: { ...designResolution }, viewport: { ...viewport }, mode };
}

function mapCorners(corners: Point[], fit: FitTransform): Point[] { return corners.map((corner) => ({ x: corner.x * fit.scale.x + fit.offset.x, y: corner.y * fit.scale.y + fit.offset.y })); }
function intersects(a: Aabb, b: Aabb): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function intersection(a: Aabb, b: Aabb): Aabb | null {
    if (!intersects(a, b)) return null;
    const x = Math.max(a.x, b.x); const y = Math.max(a.y, b.y);
    return { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y };
}
function identityPath(node: LiveNode, fallback: string): string { return typeof node.uuid === 'string' && node.uuid ? fallback : fallback; }
function isUiNode(node: LiveNode): boolean { return !!componentNamed(node, 'UITransform') || !!componentNamed(node, 'Canvas') || !!componentNamed(node, 'Widget') || !!componentNamed(node, 'Layout') || !!componentNamed(node, 'Mask') || !!componentNamed(node, 'ScrollView'); }
function isActive(node: LiveNode): boolean { return node.activeInHierarchy !== undefined ? !!node.activeInHierarchy : node.active !== false; }
function sceneNodeByPath(root: LiveNode, path: string): LiveNode | null {
    const parts = path.split('/').filter(Boolean); let current: LiveNode | null = root;
    for (const part of parts) { current = current?.children?.find((child) => child.name === part) ?? null; if (!current) return null; }
    return current;
}
function findNode(root: LiveNode, id: string): LiveNode | null {
    const stack = [root];
    while (stack.length) { const node = stack.pop()!; if (node.uuid === id) return node; for (const child of node.children ?? []) stack.push(child); }
    return null;
}
function containsNode(root: LiveNode, target: LiveNode): boolean {
    if (root === target || (!!root.uuid && root.uuid === target.uuid)) return true;
    return (root.children ?? []).some((child) => containsNode(child, target));
}

function nearestAncestor(node: LiveNode, predicate: (node: LiveNode) => boolean): LiveNode | null { let current = node.parent ?? null; while (current) { if (predicate(current)) return current; current = current.parent ?? null; } return null; }

function referencedNode(value: unknown): LiveNode | undefined {
    const candidate = unwrap(value);
    if (!candidate || typeof candidate !== 'object') return undefined;
    const record = candidate as Record<string, unknown>;
    const nested = unwrap(record.node);
    if (nested && typeof nested === 'object') return nested as LiveNode;
    if ('worldMatrix' in record || 'children' in record) return record as LiveNode;
    return undefined;
}

function referencedNodeId(value: unknown): string | undefined {
    const candidate = unwrap(value);
    if (!candidate || typeof candidate !== 'object') return undefined;
    const record = candidate as Record<string, unknown>;
    const direct = record.uuid ?? record.id;
    if (typeof direct === 'string') return direct;
    return referencedNode(record)?.uuid;
}

function collectConstraints(node: LiveNode): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const widget = componentNamed(node, 'Widget');
    if (widget) result.widget = {
        enabled: readProperty(widget, 'enabled', 'isAlignEnabled') !== false,
        alignFlags: readProperty(widget, 'alignFlags'),
        target: referencedNodeId(readProperty(widget, 'target')),
        left: readProperty(widget, 'left'), right: readProperty(widget, 'right'), top: readProperty(widget, 'top'), bottom: readProperty(widget, 'bottom'),
        horizontalCenter: readProperty(widget, 'horizontalCenter'), verticalCenter: readProperty(widget, 'verticalCenter'),
        isAlignLeft: readProperty(widget, 'isAlignLeft'), isAlignRight: readProperty(widget, 'isAlignRight'), isAlignTop: readProperty(widget, 'isAlignTop'), isAlignBottom: readProperty(widget, 'isAlignBottom'),
        isAlignHorizontalCenter: readProperty(widget, 'isAlignHorizontalCenter'), isAlignVerticalCenter: readProperty(widget, 'isAlignVerticalCenter'),
        isAbsoluteLeft: readProperty(widget, 'isAbsoluteLeft'), isAbsoluteRight: readProperty(widget, 'isAbsoluteRight'), isAbsoluteTop: readProperty(widget, 'isAbsoluteTop'), isAbsoluteBottom: readProperty(widget, 'isAbsoluteBottom'),
        isAbsoluteHorizontalCenter: readProperty(widget, 'isAbsoluteHorizontalCenter'), isAbsoluteVerticalCenter: readProperty(widget, 'isAbsoluteVerticalCenter'),
    };
    const layout = componentNamed(node, 'Layout');
    if (layout) result.layout = {
        type: readProperty(layout, 'type'), resizeMode: readProperty(layout, 'resizeMode'), startAxis: readProperty(layout, 'startAxis'),
        spacingX: readProperty(layout, 'spacingX'), spacingY: readProperty(layout, 'spacingY'), paddingLeft: readProperty(layout, 'paddingLeft'), paddingRight: readProperty(layout, 'paddingRight'), paddingTop: readProperty(layout, 'paddingTop'), paddingBottom: readProperty(layout, 'paddingBottom'),
    };
    const mask = componentNamed(node, 'Mask');
    if (mask) result.mask = { type: readProperty(mask, 'type'), inverted: readProperty(mask, 'inverted'), alphaThreshold: readProperty(mask, 'alphaThreshold') };
    const scroll = componentNamed(node, 'ScrollView');
    if (scroll) result.scrollView = {
        horizontal: readProperty(scroll, 'horizontal'), vertical: readProperty(scroll, 'vertical'), inertia: readProperty(scroll, 'inertia'), elastic: readProperty(scroll, 'elastic'),
        view: referencedNodeId(readProperty(scroll, 'view')), content: referencedNodeId(readProperty(scroll, 'content')),
    };
    return result;
}

function issue(code: string, severity: IssueSeverity, node: LayoutReportNode, message: string, evidence: Record<string, any>, relatedNodeId?: string): LayoutIssue {
    return { code, severity, nodeId: node.uuid, relatedNodeId, message, evidence };
}

function overlayError(code: string, message: string, evidence: Record<string, any> = {}): LayoutOverlayError {
    return { code, message, evidence };
}

function rasterSize(viewport: { width: number; height: number }): { width: number; height: number; scale: Point } {
    const sourceWidth = viewport.width;
    const sourceHeight = viewport.height;
    const scale = Math.min(
        1,
        MAX_OVERLAY_DIMENSION / sourceWidth,
        MAX_OVERLAY_DIMENSION / sourceHeight,
        Math.sqrt(MAX_OVERLAY_PIXELS / (sourceWidth * sourceHeight)),
    );
    return {
        width: Math.max(1, Math.floor(sourceWidth * scale)),
        height: Math.max(1, Math.floor(sourceHeight * scale)),
        scale: { x: scale, y: scale },
    };
}

function pngByteLength(base64: string): number {
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return -1;
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.floor(base64.length * 3 / 4) - padding;
}

function hasPngSignature(base64: string): boolean {
    try {
        const signature = Buffer.from(base64.slice(0, 16), 'base64');
        return signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    } catch {
        return false;
    }
}

function renderOverlay(report: LayoutReport): Omit<LayoutOverlayStatus, 'requested' | 'maxResponseBytes' | 'responseBytes'> {
    const result: Omit<LayoutOverlayStatus, 'requested' | 'maxResponseBytes' | 'responseBytes'> = {
        valid: false,
        rendered: false,
        cleaned: true,
        maxArtifactBytes: report.overlay.maxArtifactBytes,
        sourceNodeCount: report.nodes.length,
        sourceIssueCount: report.issues.length,
    };
    const documentObject: any = (globalThis as any).document;
    if (!documentObject?.createElement) {
        result.error = overlayError('OVERLAY_UNAVAILABLE', 'Overlay rendering requires a DOM canvas implementation');
        return result;
    }

    let canvas: any;
    try {
        const raster = rasterSize(report.viewport);
        canvas = documentObject.createElement('canvas');
        canvas.width = raster.width;
        canvas.height = raster.height;
        canvas.setAttribute?.('data-ccb3x-ui-layout-overlay', 'true');
        const context = canvas.getContext?.('2d');
        if (!context) {
            result.error = overlayError('OVERLAY_CONTEXT_UNAVAILABLE', 'A 2D canvas context is unavailable');
        } else if (typeof canvas.toDataURL !== 'function') {
            result.error = overlayError('OVERLAY_ENCODING_UNAVAILABLE', 'Canvas PNG encoding is unavailable');
        } else {
            const toRaster = (corner: Point): Point => ({
                x: corner.x * raster.scale.x,
                y: raster.height - corner.y * raster.scale.y,
            });
            context.lineWidth = Math.max(1, raster.scale.x);
            for (const node of report.nodes) {
                const corners = node.screenCorners.map(toRaster);
                if (!corners.length) continue;
                context.beginPath();
                context.moveTo(corners[0].x, corners[0].y);
                for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
                context.closePath();
                context.strokeStyle = '#22aaff';
                context.stroke();
            }
            const nodesById = new Map(report.nodes.map((node) => [node.uuid, node]));
            for (const issueItem of report.issues) {
                const node = issueItem.nodeId ? nodesById.get(issueItem.nodeId) : undefined;
                if (!node) continue;
                const center = toRaster({
                    x: node.screenAabb.x + node.screenAabb.width / 2,
                    y: node.screenAabb.y + node.screenAabb.height / 2,
                });
                context.beginPath();
                context.arc(center.x, center.y, Math.max(3, 4 * raster.scale.x), 0, Math.PI * 2);
                context.fillStyle = issueItem.severity === 'error' ? '#ff3344' : issueItem.severity === 'warning' ? '#ffb020' : '#dd66ff';
                context.fill();
                if (typeof context.fillText === 'function') {
                    context.font = `${Math.max(9, Math.round(11 * raster.scale.x))}px sans-serif`;
                    context.fillText(issueItem.code, center.x + 6, center.y - 6);
                }
            }

            const dataUrl = String(canvas.toDataURL('image/png'));
            const prefix = 'data:image/png;base64,';
            const data = dataUrl.startsWith(prefix) ? dataUrl.slice(prefix.length) : '';
            const byteLength = pngByteLength(data);
            if (byteLength <= 0 || !hasPngSignature(data)) {
                result.error = overlayError('OVERLAY_INVALID_IMAGE', 'Canvas did not produce a valid PNG payload');
            } else if (byteLength > result.maxArtifactBytes) {
                result.error = overlayError('OVERLAY_ARTIFACT_LIMIT_EXCEEDED', 'PNG overlay exceeds the artifact byte limit', {
                    byteLength,
                    maxArtifactBytes: result.maxArtifactBytes,
                });
            } else {
                result.artifact = {
                    mimeType: 'image/png',
                    encoding: 'base64',
                    data,
                    byteLength,
                    width: raster.width,
                    height: raster.height,
                    scale: raster.scale,
                };
                result.valid = true;
                result.rendered = true;
            }
        }
    } catch (error) {
        result.error = overlayError('OVERLAY_RENDER_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
        try {
            if (canvas?.parentNode?.removeChild) canvas.parentNode.removeChild(canvas);
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        } catch (error) {
            result.cleaned = false;
            result.valid = false;
            result.rendered = false;
            delete result.artifact;
            result.error = overlayError('OVERLAY_CLEANUP_FAILED', error instanceof Error ? error.message : String(error));
        }
    }
    return result;
}

function serializedBytes(report: LayoutReport): number {
    return Buffer.byteLength(JSON.stringify(report), 'utf8');
}

function refreshResponseBytes(report: LayoutReport): number {
    for (let attempt = 0; attempt < 8; attempt++) {
        const measured = serializedBytes(report);
        if (report.overlay.responseBytes === measured) return measured;
        report.overlay.responseBytes = measured;
    }
    return serializedBytes(report);
}

function compactText(value: unknown, limit = 256): unknown {
    if (typeof value !== 'string' || value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function compactJson(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return compactText(value);
    if (depth > 3) return '[depth-limited]';
    if (Array.isArray(value)) return value.slice(0, 32).map((item) => compactJson(item, depth + 1));
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, 32)) result[String(compactText(key, 128))] = compactJson(item, depth + 1);
        return result;
    }
    return value;
}

function compactReport(report: LayoutReport): void {
    report.root.uuid = String(compactText(report.root.uuid, 128));
    report.root.path = String(compactText(report.root.path, 512));
    report.root.name = String(compactText(report.root.name, 256));
    for (const item of report.nodes) {
        item.uuid = String(compactText(item.uuid, 128));
        item.path = String(compactText(item.path, 512));
        item.name = String(compactText(item.name, 256));
        item.components = item.components.map((name) => String(compactText(name, 128)));
        item.constraints = compactJson(item.constraints) as Record<string, any>;
    }
    for (const item of report.issues) {
        item.code = String(compactText(item.code, 128));
        item.message = String(compactText(item.message, 256));
        item.nodeId = item.nodeId ? String(compactText(item.nodeId, 128)) : item.nodeId;
        item.relatedNodeId = item.relatedNodeId ? String(compactText(item.relatedNodeId, 128)) : item.relatedNodeId;
        item.evidence = compactJson(item.evidence) as Record<string, any>;
    }
    report.truncation = report.truncation.map((item) => ({ ...item, reason: String(compactText(item.reason, 160)) }));
    if (report.overlay.error) {
        report.overlay.error.message = String(compactText(report.overlay.error.message, 256));
        report.overlay.error.code = String(compactText(report.overlay.error.code, 128));
        report.overlay.error.evidence = compactJson(report.overlay.error.evidence) as Record<string, any>;
    }
}

function boundedLayoutError(code: string, message: string, evidence: Record<string, unknown>, maxBytes: number): LayoutReportError {
    const make = (nextMessage: string, nextEvidence: Record<string, unknown>): LayoutReportError => ({
        error: { code, message: nextMessage, evidence: nextEvidence },
    });
    let result = make(String(compactText(message, 256)), compactJson(evidence) as Record<string, unknown>);
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) result = make('UI layout report request failed', { maxBytes });
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) result = make('UI layout report failed', {});
    return result;
}

function enforceByteLimit(report: LayoutReport, maxBytes: number): LayoutReportResult {
    compactReport(report);
    if (serializedBytes(report) > maxBytes && report.overlay.artifact) {
        const attemptedResponseBytes = serializedBytes(report);
        const artifactByteLength = report.overlay.artifact.byteLength;
        delete report.overlay.artifact;
        report.overlay.valid = false;
        report.overlay.rendered = false;
        report.overlay.error = overlayError('OVERLAY_RESPONSE_LIMIT_EXCEEDED', 'Overlay payload would exceed the serialized response byte limit', {
            attemptedResponseBytes,
            artifactByteLength,
            maxResponseBytes: maxBytes,
        });
    }
    let omittedIssues = 0;
    let omittedNodes = 0;
    if (serializedBytes(report) > maxBytes) {
        report.complete = false;
        if (!report.truncation.some((item) => item.kind === 'bytes')) report.truncation.push({ kind: 'bytes', limit: maxBytes, reason: 'serialized response limit reached' });
    }
    while (serializedBytes(report) > maxBytes && report.issues.length) {
        report.issues.pop();
        omittedIssues++;
    }
    while (serializedBytes(report) > maxBytes && report.nodes.length) {
        report.nodes.pop();
        omittedNodes++;
    }
    if (omittedIssues || omittedNodes) {
        const bytes = report.truncation.find((item) => item.kind === 'bytes');
        if (bytes) bytes.omitted = omittedIssues + omittedNodes;
    }
    compactReport(report);
    refreshResponseBytes(report);
    return serializedBytes(report) <= maxBytes
        ? report
        : boundedLayoutError('UI_LAYOUT_RESPONSE_LIMIT_EXCEEDED', 'UI layout report cannot fit within maxBytes', { maxBytes }, maxBytes);
}

export function finalizeUiLayoutReport(report: LayoutReport, maxBytes: number): LayoutReportResult {
    return enforceByteLimit(report, maxBytes);
}

interface ClipRegion {
    aabb: Aabb;
    sourceId?: string;
}

function pathSegment(node: LiveNode, siblingIndex: number): string {
    const name = String(node.name || 'node');
    const id = String(node.uuid || siblingIndex);
    return `${name}[${id}]`;
}

function liveAabb(node: LiveNode, fit: FitTransform): Aabb | null {
    const transform = componentNamed(node, 'UITransform');
    if (!transform) return null;
    const rawSize = readProperty(transform, 'contentSize', '_contentSize') ?? { width: 0, height: 0 };
    const rawAnchor = readProperty(transform, 'anchorPoint', '_anchorPoint') ?? { x: 0.5, y: 0.5 };
    const size = { width: num(rawSize.width), height: num(rawSize.height) };
    const matrix = extractMatrix(node.worldMatrix ?? node._worldMatrix);
    return aabbFromCorners(mapCorners(transformCorners(localCorners(size, point(rawAnchor)), matrix), fit));
}

function isDescendant(node: LiveNode, ancestor: LiveNode): boolean {
    let current: LiveNode | null = node;
    while (current) {
        if (current === ancestor || (!!current.uuid && current.uuid === ancestor.uuid)) return true;
        current = current.parent ?? null;
    }
    return false;
}

function addIssue(report: LayoutReport, item: LayoutIssue): void {
    report.issues.push(item);
}

export function buildUiLayoutReport(sceneRoot: LiveNode, request: LayoutReportRequest): LayoutReportResult {
    const maxNodes = Math.min(request.maxNodes ?? DEFAULT_MAX_NODES, MAX_LIMIT);
    const maxIssues = Math.min(request.maxIssues ?? DEFAULT_MAX_ISSUES, MAX_LIMIT);
    const maxBytes = Math.min(request.maxBytes ?? DEFAULT_MAX_BYTES, 2 * 1024 * 1024);
    const fitMode = request.fitMode ?? 'contain';
    const alignmentTolerance = request.alignmentTolerance ?? 1;
    const gapTolerance = request.gapTolerance ?? 2;
    if (!request.root?.id && !request.rootPath) return boundedLayoutError('UI_LAYOUT_ROOT_REQUIRED', 'A root id or rootPath is required', {}, maxBytes);
    let root: LiveNode | null = null;
    if (request.root?.id) root = findNode(sceneRoot, request.root.id);
    else if (request.rootPath) root = sceneNodeByPath(sceneRoot, request.rootPath);
    if (!root) return boundedLayoutError('UI_LAYOUT_ROOT_NOT_FOUND', 'Requested UI layout root does not resolve to a live node', { requestedRoot: request.root?.id ?? request.rootPath ?? null }, maxBytes);
    if (!isUiNode(root)) return boundedLayoutError('UI_LAYOUT_ROOT_NOT_UI', 'Requested root is not a Canvas or UI-bearing subtree root', { uuid: root.uuid, name: root.name, components: componentsOf(root).map(componentType) }, maxBytes);
    const rootPath = String(root.name || root.uuid || 'root');
    let fit: FitTransform;
    try { fit = resolveFit(request.designResolution, request.viewport, fitMode); } catch (error) {
        return boundedLayoutError('UI_LAYOUT_INVALID_GEOMETRY', error instanceof Error ? error.message : String(error), { designResolution: request.designResolution, viewport: request.viewport }, maxBytes);
    }
    const report: LayoutReport = {
        complete: true, designResolution: { ...request.designResolution }, viewport: { ...request.viewport }, fitMode, fit,
        root: { uuid: root.uuid ?? '', path: rootPath, name: root.name ?? root.uuid ?? '' }, nodes: [], issues: [], truncation: [],
        overlay: { requested: !!request.overlay, valid: false, rendered: false, cleaned: true, maxArtifactBytes: Math.min(MAX_OVERLAY_BYTES, maxBytes), maxResponseBytes: maxBytes, responseBytes: 0, sourceNodeCount: 0, sourceIssueCount: 0 },
        tolerances: { alignment: alignmentTolerance, gap: gapTolerance },
    };
    const liveById = new Map<string, LiveNode>();
    const indexLive = (node: LiveNode): void => {
        if (node.uuid) liveById.set(node.uuid, node);
        for (const child of node.children ?? []) indexLive(child);
    };
    indexLive(sceneRoot);
    const nodeById = new Map<string, LayoutReportNode>();
    let omittedEligibleNodes = 0;
    const visit = (node: LiveNode, path: string, siblingIndex: number, clips: ClipRegion[]): void => {
        const transform = componentNamed(node, 'UITransform');
        let item: LayoutReportNode | undefined;
        if (isUiNode(node) && transform) {
            const rawSize = readProperty(transform, 'contentSize', '_contentSize') ?? { width: 0, height: 0 };
            const size = { width: num(rawSize.width), height: num(rawSize.height) };
            const rawAnchor = readProperty(transform, 'anchorPoint', '_anchorPoint') ?? { x: 0.5, y: 0.5 };
            const anchor = point(rawAnchor);
            const matrix = extractMatrix(node.worldMatrix ?? node._worldMatrix);
            const world = transformCorners(localCorners(size, anchor), matrix);
            const screen = mapCorners(world, fit);
            item = {
                uuid: node.uuid ?? '', path, name: node.name ?? node.uuid ?? '', active: isActive(node), siblingIndex, components: componentsOf(node).map(componentType),
                localTransform: { position: point(node.position), scale: point(node.scale ?? { x: 1, y: 1 }), rotation: node.rotation ?? null, eulerAngles: node.eulerAngles ?? null, skewX: num(node.skewX), skewY: num(node.skewY) },
                worldMatrix: matrix, worldCorners: world, designAabb: aabbFromCorners(world), screenCorners: screen, screenAabb: aabbFromCorners(screen), anchor, size, constraints: collectConstraints(node),
            };
            if (report.nodes.length < maxNodes) {
                report.nodes.push(item);
                if (item.uuid) nodeById.set(item.uuid, item);
                if (item.active) {
                    if (size.width <= 0 || size.height <= 0) addIssue(report, issue('NON_POSITIVE_SIZE', 'error', item, 'UITransform has non-positive content size', { size }));
                    if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1) addIssue(report, issue('ANCHOR_OUT_OF_RANGE', 'warning', item, 'Anchor point lies outside the normalized range', { anchor }));
                    const viewportAabb = { x: 0, y: 0, width: request.viewport.width, height: request.viewport.height };
                    if (!intersects(item.screenAabb, viewportAabb)) addIssue(report, issue('OFF_SCREEN', 'warning', item, 'UI bounds lie outside the viewport', { screenAabb: item.screenAabb, viewport: viewportAabb }));
                    for (const clip of clips) {
                        const overlap = intersection(item.screenAabb, clip.aabb);
                        const clipped = !overlap || overlap.width < item.screenAabb.width || overlap.height < item.screenAabb.height;
                        if (clipped) addIssue(report, issue('CLIPPED_BY_ANCESTOR', 'warning', item, 'UI bounds are clipped by an ancestor viewport', { screenAabb: item.screenAabb, clipAabb: clip.aabb, visibleAabb: overlap ?? { x: 0, y: 0, width: 0, height: 0 }, fullyOutside: !overlap, clipSourceId: clip.sourceId }));
                    }
                }
            } else omittedEligibleNodes++;
        }
        const inheritedClips = [...clips];
        if (transform && componentNamed(node, 'Mask')) {
            const aabb = liveAabb(node, fit);
            if (aabb) inheritedClips.push({ aabb, sourceId: node.uuid });
        }
        const scroll = componentNamed(node, 'ScrollView');
        let scrollViewNode: LiveNode | undefined;
        let scrollViewClip: ClipRegion | undefined;
        if (scroll) {
            const viewId = referencedNodeId(readProperty(scroll, 'view'));
            scrollViewNode = (viewId ? liveById.get(viewId) : undefined) ?? referencedNode(readProperty(scroll, 'view'));
            const aabb = scrollViewNode ? liveAabb(scrollViewNode, fit) : null;
            if (aabb) scrollViewClip = { aabb, sourceId: scrollViewNode?.uuid ?? viewId };
        }
        for (let i = 0; i < (node.children ?? []).length; i++) {
            const child = node.children![i];
            const childClips = scrollViewClip && scrollViewNode && containsNode(child, scrollViewNode)
                ? [...inheritedClips, scrollViewClip]
                : inheritedClips;
            visit(child, `${path}/${pathSegment(child, i)}`, i, childClips);
        }
    };
    visit(root, rootPath, 0, []);
    if (omittedEligibleNodes > 0) {
        report.complete = false;
        report.truncation.push({ kind: 'nodes', limit: maxNodes, omitted: omittedEligibleNodes, reason: 'eligible UI node inventory limit reached' });
    }
    for (const item of report.nodes) {
        if (!item.active) continue;
        const live = item.uuid ? liveById.get(item.uuid) : undefined;
        if (live) evaluateWidget(item, live, nodeById, alignmentTolerance, report.issues);
        if (live) evaluateScrollView(item, live, liveById, nodeById, report.issues);
    }
    detectSiblingDiagnostics(report, gapTolerance, alignmentTolerance);
    evaluateParentLayouts(report, liveById, nodeById, gapTolerance);
    if (report.issues.length > maxIssues) {
        const omitted = report.issues.length - maxIssues;
        report.issues.length = maxIssues;
        report.complete = false;
        report.truncation.push({ kind: 'issues', limit: maxIssues, omitted, reason: 'issue limit reached' });
    }
    if (request.overlay) {
        report.overlay = { requested: true, maxResponseBytes: maxBytes, responseBytes: report.overlay.responseBytes, ...renderOverlay(report) };
    }
    return finalizeUiLayoutReport(report, maxBytes);
}

function alignFlag(widget: Record<string, any>, boolName: string, bit: number): boolean {
    if (typeof widget[boolName] === 'boolean') return widget[boolName];
    return typeof widget.alignFlags === 'number' && (widget.alignFlags & bit) !== 0;
}

function widgetExpected(value: unknown, absolute: unknown, size: number): number | undefined {
    if (typeof value !== 'number') return undefined;
    return absolute === false ? value * size : value;
}

function evaluateWidget(item: LayoutReportNode, node: LiveNode, nodeById: Map<string, LayoutReportNode>, tolerance: number, issues: LayoutIssue[]): void {
    const widget = item.constraints.widget as Record<string, any> | undefined;
    if (!widget || widget.enabled === false) return;
    const target = (typeof widget.target === 'string' ? nodeById.get(widget.target) : undefined) ?? (node.parent?.uuid ? nodeById.get(node.parent.uuid) : undefined);
    if (!target) return;
    const checks: Array<[string, boolean, number | undefined, number, number]> = [
        ['left', alignFlag(widget, 'isAlignLeft', 8), widgetExpected(widget.left, widget.isAbsoluteLeft, target.designAabb.width), item.designAabb.x - target.designAabb.x, 0],
        ['right', alignFlag(widget, 'isAlignRight', 32), widgetExpected(widget.right, widget.isAbsoluteRight, target.designAabb.width), target.designAabb.x + target.designAabb.width - item.designAabb.x - item.designAabb.width, 0],
        ['bottom', alignFlag(widget, 'isAlignBottom', 4), widgetExpected(widget.bottom, widget.isAbsoluteBottom, target.designAabb.height), item.designAabb.y - target.designAabb.y, 0],
        ['top', alignFlag(widget, 'isAlignTop', 1), widgetExpected(widget.top, widget.isAbsoluteTop, target.designAabb.height), target.designAabb.y + target.designAabb.height - item.designAabb.y - item.designAabb.height, 0],
    ];
    for (const [edge, enabled, expected, actual, baseline] of checks) {
        if (enabled && expected !== undefined && Math.abs(actual - (baseline + expected)) > tolerance) issues.push(issue('WIDGET_CONSTRAINT_VIOLATION', 'warning', item, `Widget ${edge} constraint does not match live geometry`, { edge, expected, actual, baseline, units: 'design', tolerance }));
    }
    const horizontalCenter = alignFlag(widget, 'isAlignHorizontalCenter', 16);
    const verticalCenter = alignFlag(widget, 'isAlignVerticalCenter', 2);
    const expectedHorizontal = widgetExpected(widget.horizontalCenter, widget.isAbsoluteHorizontalCenter, target.designAabb.width);
    const expectedVertical = widgetExpected(widget.verticalCenter, widget.isAbsoluteVerticalCenter, target.designAabb.height);
    if (horizontalCenter && expectedHorizontal !== undefined) {
        const actual = item.designAabb.x + item.designAabb.width / 2 - (target.designAabb.x + target.designAabb.width / 2);
        if (Math.abs(actual - expectedHorizontal) > tolerance) issues.push(issue('WIDGET_CONSTRAINT_VIOLATION', 'warning', item, 'Widget horizontal center constraint does not match live geometry', { edge: 'horizontalCenter', expected: expectedHorizontal, actual, units: 'design', tolerance }));
    }
    if (verticalCenter && expectedVertical !== undefined) {
        const actual = item.designAabb.y + item.designAabb.height / 2 - (target.designAabb.y + target.designAabb.height / 2);
        if (Math.abs(actual - expectedVertical) > tolerance) issues.push(issue('WIDGET_CONSTRAINT_VIOLATION', 'warning', item, 'Widget vertical center constraint does not match live geometry', { edge: 'verticalCenter', expected: expectedVertical, actual, units: 'design', tolerance }));
    }
}

function evaluateScrollView(item: LayoutReportNode, node: LiveNode, liveById: Map<string, LiveNode>, nodeById: Map<string, LayoutReportNode>, issues: LayoutIssue[]): void {
    const scroll = item.constraints.scrollView as Record<string, any> | undefined;
    if (!scroll) return;
    const view = typeof scroll.view === 'string' ? liveById.get(scroll.view) : undefined;
    const content = typeof scroll.content === 'string' ? liveById.get(scroll.content) : undefined;
    const viewReport = typeof scroll.view === 'string' ? nodeById.get(scroll.view) : undefined;
    const contentReport = typeof scroll.content === 'string' ? nodeById.get(scroll.content) : undefined;
    if (!view || !content || !viewReport || !contentReport || !isDescendant(view, node) || !isDescendant(content, view)) {
        issues.push(issue('SCROLLVIEW_CONSTRAINT_VIOLATION', 'warning', item, 'ScrollView view/content relationship is unresolved or outside the ScrollView subtree', { view: scroll.view ?? null, content: scroll.content ?? null }));
        return;
    }
    if (scroll.horizontal === false && (contentReport.designAabb.x < viewReport.designAabb.x || contentReport.designAabb.x + contentReport.designAabb.width > viewReport.designAabb.x + viewReport.designAabb.width)) {
        issues.push(issue('SCROLLVIEW_CONSTRAINT_VIOLATION', 'warning', item, 'ScrollView content exceeds a non-scrollable horizontal viewport', { axis: 'horizontal', viewAabb: viewReport.designAabb, contentAabb: contentReport.designAabb }));
    }
    if (scroll.vertical === false && (contentReport.designAabb.y < viewReport.designAabb.y || contentReport.designAabb.y + contentReport.designAabb.height > viewReport.designAabb.y + viewReport.designAabb.height)) {
        issues.push(issue('SCROLLVIEW_CONSTRAINT_VIOLATION', 'warning', item, 'ScrollView content exceeds a non-scrollable vertical viewport', { axis: 'vertical', viewAabb: viewReport.designAabb, contentAabb: contentReport.designAabb }));
    }
}

function evaluateParentLayouts(report: LayoutReport, liveById: Map<string, LiveNode>, nodeById: Map<string, LayoutReportNode>, tolerance: number): void {
    for (const parent of report.nodes) {
        const layout = parent.constraints.layout as Record<string, any> | undefined;
        const liveParent = parent.uuid ? liveById.get(parent.uuid) : undefined;
        if (!layout || !liveParent) continue;
        const children = (liveParent.children ?? []).map((child) => child.uuid ? nodeById.get(child.uuid) : undefined).filter((child): child is LayoutReportNode => !!child && child.active);
        const layoutType = layout.type;
        const horizontal = layoutType === 1 || layoutType === 'HORIZONTAL' || layoutType === 'horizontal';
        const vertical = layoutType === 2 || layoutType === 'VERTICAL' || layoutType === 'vertical';
        const ordered = children.slice().sort((a, b) => horizontal ? a.designAabb.x - b.designAabb.x : a.designAabb.y - b.designAabb.y);
        const gaps: number[] = [];
        for (let i = 1; i < ordered.length; i++) gaps.push(horizontal ? ordered[i].designAabb.x - ordered[i - 1].designAabb.x - ordered[i - 1].designAabb.width : ordered[i].designAabb.y - ordered[i - 1].designAabb.y - ordered[i - 1].designAabb.height);
        if (gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) > tolerance) report.issues.push(issue('LAYOUT_GAP_INCONSISTENT', 'warning', parent, 'Layout child gaps are inconsistent', { parentId: parent.uuid, gaps, units: 'design', tolerance }));
        const expected = horizontal ? layout.spacingX : vertical ? layout.spacingY : undefined;
        if (typeof expected === 'number') {
            const mismatches = gaps.filter((gap) => Math.abs(gap - expected) > tolerance);
            if (mismatches.length) report.issues.push(issue('LAYOUT_CONSTRAINT_VIOLATION', 'warning', parent, 'Layout child spacing does not match the parent Layout constraint', { parentId: parent.uuid, axis: horizontal ? 'horizontal' : vertical ? 'vertical' : 'unspecified', expected, gaps, units: 'design', tolerance }));
        }
    }
}

function detectSiblingDiagnostics(report: LayoutReport, _gapTolerance: number, alignmentTolerance: number): void {
    const byParent = new Map<string, LayoutReportNode[]>();
    for (const node of report.nodes) {
        const parentPath = node.path.slice(0, Math.max(0, node.path.lastIndexOf('/')));
        const list = byParent.get(parentPath) ?? [];
        list.push(node);
        byParent.set(parentPath, list);
    }
    for (const siblings of byParent.values()) {
        for (let i = 0; i < siblings.length; i++) for (let j = i + 1; j < siblings.length; j++) {
            const a = siblings[i]; const b = siblings[j];
            if (!a.active || !b.active) continue;
            const overlap = intersection(a.screenAabb, b.screenAabb);
            if (overlap) report.issues.push(issue('OVERLAP', 'advisory', a, 'Active UI bounds overlap another sibling', { pair: [a.uuid, b.uuid], intersection: overlap }, b.uuid));
            const edgeDelta = Math.min(Math.abs(a.designAabb.x - b.designAabb.x), Math.abs(a.designAabb.y - b.designAabb.y), Math.abs((a.designAabb.x + a.designAabb.width) - (b.designAabb.x + b.designAabb.width)), Math.abs((a.designAabb.y + a.designAabb.height) - (b.designAabb.y + b.designAabb.height)));
            if (edgeDelta > 0 && edgeDelta <= alignmentTolerance) report.issues.push(issue('NEAR_ALIGNMENT', 'advisory', a, 'Sibling edges are near-aligned within tolerance', { pair: [a.uuid, b.uuid], delta: edgeDelta, units: 'design', tolerance: alignmentTolerance }, b.uuid));
        }
    }
}

export const layoutReportLimits = { DEFAULT_MAX_NODES, DEFAULT_MAX_ISSUES, DEFAULT_MAX_BYTES, MAX_LIMIT };
