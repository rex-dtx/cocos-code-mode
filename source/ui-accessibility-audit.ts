import { buildUiLayoutReport, LayoutReport } from './ui-layout-report';

export type UiAccessibilityRole = 'button' | 'toggle' | 'slider' | 'edit-box' | 'label' | 'generic';
export type UiAccessibilityLabelSource = 'label' | 'descendant-label' | 'edit-box-placeholder' | 'node-name';
export type UiAccessibilityIssueCode = 'MISSING_ACCESSIBLE_LABEL' | 'DUPLICATE_ACCESSIBLE_LABEL';

export interface UiAccessibilityAuditRequest {
    root?: { id?: string; type?: string };
    rootPath?: string;
    maxNodes?: number;
    maxIssues?: number;
}

export interface UiAccessibilityNode {
    uuid: string;
    path: string;
    name: string;
    active: true;
    role: UiAccessibilityRole;
    label: string | null;
    labelSource: UiAccessibilityLabelSource | null;
    interactable: boolean;
    interactionComponent: 'cc.Button' | 'cc.Toggle' | 'cc.Slider' | 'cc.EditBox' | null;
    components: string[];
}

export interface UiAccessibilityIssue {
    code: UiAccessibilityIssueCode;
    severity: 'warning';
    nodeId: string;
    relatedNodeIds: string[];
    message: string;
    evidence: Record<string, unknown>;
}

export interface UiAccessibilityAuditReport {
    complete: boolean;
    valid: boolean;
    truncated: boolean;
    checkedNodes: number;
    root: LayoutReport['root'];
    nodes: UiAccessibilityNode[];
    issues: UiAccessibilityIssue[];
    truncation: Array<{ kind: 'nodes' | 'issues'; limit: number; omitted?: number; reason: string }>;
}

export interface UiAccessibilityAuditError {
    error: { code: string; message: string; evidence: Record<string, unknown> };
}

export type UiAccessibilityAuditResult = UiAccessibilityAuditReport | UiAccessibilityAuditError;

type InteractionComponent = UiAccessibilityNode['interactionComponent'];
type LiveComponent = Record<string, any>;
interface LiveNode {
    uuid?: string;
    name?: string;
    active?: boolean;
    activeInHierarchy?: boolean;
    children?: LiveNode[];
    components?: LiveComponent[];
}

const DEFAULT_MAX_NODES = 128;
const DEFAULT_MAX_ISSUES = 256;
const MAX_LIMIT = 5000;
const MAX_LABEL_LENGTH = 256;
const INTERACTION_COMPONENTS: InteractionComponent[] = ['cc.Button', 'cc.Toggle', 'cc.Slider', 'cc.EditBox'];

function error(code: string, message: string, evidence: Record<string, unknown> = {}): UiAccessibilityAuditError {
    return { error: { code, message, evidence } };
}

function validLimit(value: unknown, fallback: number): number | null {
    if (value === undefined) return fallback;
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIMIT ? value as number : null;
}

function unwrap(value: unknown): unknown {
    return value && typeof value === 'object' && 'value' in value ? (value as { value: unknown }).value : value;
}

function componentType(component: LiveComponent): string {
    let runtimeName: unknown;
    try {
        runtimeName = (globalThis as any).cc?.js?.getClassName?.(component);
    } catch {
        runtimeName = undefined;
    }
    const value = [runtimeName, component.__classname__, component._className, component.constructor?.name, component.type]
        .find((candidate) => typeof candidate === 'string' && candidate.length > 0 && candidate !== 'Object');
    const name = typeof value === 'string' ? value : 'cc.Component';
    return name.startsWith('cc.') ? name : `cc.${name}`;
}

function componentsOf(node: LiveNode): LiveComponent[] {
    return Array.isArray(node.components) ? node.components : [];
}

function componentNamed(node: LiveNode, expected: string): LiveComponent | undefined {
    return componentsOf(node).find((component) => componentType(component) === expected);
}

function active(node: LiveNode): boolean {
    return node.activeInHierarchy !== undefined ? node.activeInHierarchy === true : node.active !== false;
}

function text(value: unknown): string | null {
    const resolved = unwrap(value);
    if (typeof resolved !== 'string') return null;
    const normalized = resolved.trim().replace(/\s+/g, ' ');
    if (!normalized) return null;
    return normalized.length <= MAX_LABEL_LENGTH ? normalized : `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

function labelText(node: LiveNode): string | null {
    const label = componentNamed(node, 'cc.Label');
    return label ? text(label.string ?? label._string) : null;
}

function interactionComponent(node: LiveNode): { type: InteractionComponent; component: LiveComponent } | null {
    for (const type of INTERACTION_COMPONENTS) {
        const component = componentNamed(node, type as string);
        if (component) return { type, component };
    }
    return null;
}

function descendantLabel(node: LiveNode): string | null {
    const visit = (candidate: LiveNode): string | null => {
        if (!active(candidate)) return null;
        if (interactionComponent(candidate)) return null;
        const own = labelText(candidate);
        if (own) return own;
        for (const child of candidate.children ?? []) {
            const found = visit(child);
            if (found) return found;
        }
        return null;
    };
    for (const child of node.children ?? []) {
        const found = visit(child);
        if (found) return found;
    }
    return null;
}

function inferredLabel(node: LiveNode): { label: string | null; source: UiAccessibilityLabelSource | null } {
    const own = labelText(node);
    if (own) return { label: own, source: 'label' };
    const descendant = descendantLabel(node);
    if (descendant) return { label: descendant, source: 'descendant-label' };
    const editBox = componentNamed(node, 'cc.EditBox');
    const placeholder = editBox ? text(editBox.placeholder ?? editBox._placeholder) : null;
    if (placeholder) return { label: placeholder, source: 'edit-box-placeholder' };
    const name = text(node.name);
    return name ? { label: name, source: 'node-name' } : { label: null, source: null };
}

function role(node: LiveNode, interaction: InteractionComponent): UiAccessibilityRole {
    if (interaction === 'cc.Button') return 'button';
    if (interaction === 'cc.Toggle') return 'toggle';
    if (interaction === 'cc.Slider') return 'slider';
    if (interaction === 'cc.EditBox') return 'edit-box';
    return componentNamed(node, 'cc.Label') ? 'label' : 'generic';
}

function indexNodes(root: LiveNode): Map<string, LiveNode> {
    const result = new Map<string, LiveNode>();
    const stack: LiveNode[] = [root];
    while (stack.length) {
        const node = stack.pop()!;
        if (node.uuid) result.set(node.uuid, node);
        const children = node.children ?? [];
        for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    return result;
}

export function buildUiAccessibilityAudit(sceneRoot: Parameters<typeof buildUiLayoutReport>[0], request: UiAccessibilityAuditRequest): UiAccessibilityAuditResult {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return error('UI_ACCESSIBILITY_INVALID_INPUT', 'Request must be an object', { request });
    }
    const maxNodes = validLimit(request.maxNodes, DEFAULT_MAX_NODES);
    const maxIssues = validLimit(request.maxIssues, DEFAULT_MAX_ISSUES);
    if (maxNodes === null || maxIssues === null) {
        return error('UI_ACCESSIBILITY_INVALID_INPUT', 'maxNodes and maxIssues must be integers from 1 to 5000', { maxNodes: request.maxNodes, maxIssues: request.maxIssues });
    }
    const hasId = typeof request.root?.id === 'string' && request.root.id.length > 0;
    const hasPath = typeof request.rootPath === 'string' && request.rootPath.length > 0;
    if (hasId === hasPath) {
        return error(hasId ? 'UI_ACCESSIBILITY_INVALID_INPUT' : 'UI_ACCESSIBILITY_ROOT_REQUIRED', hasId ? 'Specify exactly one of root.id or rootPath' : 'A root id or rootPath is required', { root: request.root, rootPath: request.rootPath });
    }
    if (request.root && (!hasId || (request.root.type !== undefined && typeof request.root.type !== 'string'))) {
        return error('UI_ACCESSIBILITY_INVALID_INPUT', 'root must contain a non-empty string id and optional string type', { root: request.root });
    }

    const layout = buildUiLayoutReport(sceneRoot, {
        root: request.root,
        rootPath: request.rootPath,
        designResolution: { width: 1_000_000_000, height: 1_000_000_000 },
        viewport: { width: 1_000_000_000, height: 1_000_000_000 },
        fitMode: 'none',
        maxNodes: Math.min(maxNodes + 1, MAX_LIMIT),
        maxIssues: 1,
        maxBytes: 2 * 1024 * 1024,
        diagnostics: false,
    });
    if ('error' in layout) {
        const code = layout.error.code === 'UI_LAYOUT_ROOT_NOT_FOUND' ? 'UI_ACCESSIBILITY_ROOT_NOT_FOUND'
            : layout.error.code === 'UI_LAYOUT_ROOT_NOT_UI' ? 'UI_ACCESSIBILITY_ROOT_NOT_UI'
                : 'UI_ACCESSIBILITY_INVALID_INPUT';
        return error(code, layout.error.message, layout.error.evidence);
    }

    const liveById = indexNodes(sceneRoot as LiveNode);
    const eligible = layout.nodes.filter((item) => item.active);
    const selected = eligible.slice(0, maxNodes);
    const nodes: UiAccessibilityNode[] = [];
    for (const item of selected) {
        const live = liveById.get(item.uuid);
        if (!live) continue;
        const interaction = interactionComponent(live);
        const inferred = inferredLabel(live);
        const enabled = interaction ? unwrap(interaction.component.enabled) !== false : false;
        const componentInteractable = interaction ? unwrap(interaction.component.interactable) !== false : false;
        nodes.push({
            uuid: item.uuid,
            path: item.path,
            name: item.name,
            active: true,
            role: role(live, interaction?.type ?? null),
            label: inferred.label,
            labelSource: inferred.source,
            interactable: !!interaction && enabled && componentInteractable,
            interactionComponent: interaction?.type ?? null,
            components: item.components,
        });
    }

    const allIssues: UiAccessibilityIssue[] = [];
    for (const node of nodes) {
        if (!node.interactable || node.label !== null) continue;
        allIssues.push({
            code: 'MISSING_ACCESSIBLE_LABEL',
            severity: 'warning',
            nodeId: node.uuid,
            relatedNodeIds: [],
            message: 'Active interactable UI node has no inferred label text or node name',
            evidence: { role: node.role, interactionComponent: node.interactionComponent },
        });
    }
    const labels = new Map<string, UiAccessibilityNode[]>();
    for (const node of nodes) {
        if (!node.interactable || node.label === null) continue;
        const key = node.label.trim().replace(/\s+/g, ' ').toLowerCase();
        const group = labels.get(key);
        if (group) group.push(node);
        else labels.set(key, [node]);
    }
    for (const group of labels.values()) {
        if (group.length < 2) continue;
        allIssues.push({
            code: 'DUPLICATE_ACCESSIBLE_LABEL',
            severity: 'warning',
            nodeId: group[0].uuid,
            relatedNodeIds: group.slice(1).map((node) => node.uuid),
            message: 'Multiple active interactable UI nodes share the same inferred label',
            evidence: { label: group[0].label, nodeIds: group.map((node) => node.uuid), roles: group.map((node) => node.role) },
        });
    }

    const truncation: UiAccessibilityAuditReport['truncation'] = [];
    if (!layout.complete || eligible.length > maxNodes) {
        const knownOmitted = Math.max(0, eligible.length - maxNodes);
        truncation.push({
            kind: 'nodes',
            limit: maxNodes,
            ...(knownOmitted > 0 ? { omitted: knownOmitted } : {}),
            reason: layout.complete ? 'active UI accessibility node limit reached' : 'shared UI geometry inventory was truncated',
        });
    }
    if (allIssues.length > maxIssues) {
        truncation.push({ kind: 'issues', limit: maxIssues, omitted: allIssues.length - maxIssues, reason: 'accessibility issue limit reached' });
    }
    const issues = allIssues.slice(0, maxIssues);
    const complete = truncation.length === 0;
    return {
        complete,
        valid: complete && issues.length === 0,
        truncated: !complete,
        checkedNodes: nodes.length,
        root: layout.root,
        nodes,
        issues,
        truncation,
    };
}
