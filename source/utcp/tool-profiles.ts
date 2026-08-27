// Tool profiles — graduated exposure (core/full) + access-level annotations.
// Borrowed from funplay-cocos-mcp pattern. Keeps UTCP manual strict-schema compliant
// by storing profile metadata separately from the Tool object.

export type ToolProfile = 'core' | 'full' | 'custom';
export type AccessLevel = 'read-only' | 'stateful' | 'mutating';

export interface ToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    accessLevel?: AccessLevel;
}

export interface ToolProfileMeta {
    profile: 'core' | 'full';
    annotations: ToolAnnotations;
}

// Separate registry for profile metadata — kept out of the Tool object
// so the UTCP manual stays strict-schema compliant.
const profileRegistry = new Map<string, ToolProfileMeta>();

export function registerToolProfile(name: string, meta: ToolProfileMeta): void {
    profileRegistry.set(name, meta);
}

export function getToolProfileMeta(name: string): ToolProfileMeta | undefined {
    return profileRegistry.get(name);
}

// Infer annotations from tool name + HTTP method when not explicitly provided.
export function inferAnnotations(name: string, httpMethod: string): ToolAnnotations {
    const readOnly = /^(get|list|find|read|search|check|validate|exists|capture|query|inspect|runtimeGet)/.test(name);
    const destructive = /(delete|remove|clear|replace|write|reset|set_|execute|run|invoke|emit|simulate|create|add|save|pause|resume)/.test(name);
    const idempotent = readOnly || /^(set|select|open|pause|resume|stop|refresh)/.test(name);

    let accessLevel: AccessLevel;
    if (readOnly) accessLevel = 'read-only';
    else if (httpMethod === 'GET') accessLevel = 'read-only';
    else if (destructive) accessLevel = 'mutating';
    else accessLevel = 'stateful';

    return {
        readOnlyHint: readOnly || httpMethod === 'GET',
        destructiveHint: destructive && !readOnly,
        idempotentHint: idempotent,
        accessLevel,
    };
}

// Core tools list — essential for basic workflow. Everything else is full-only.
export const CORE_TOOLS = new Set([
    // Scene essentials
    'nodeGetTree', 'nodeGetAtPath', 'nodeCreate', 'nodeOperate', 'nodeCreatePrimitive',
    'sceneGetInfo', 'sceneManage',
    // Inspector
    'inspectorGet', 'inspectorSet', 'inspectorGetDefinition',
    // Components
    'nodeComponentsGet', 'nodeComponentManage', 'nodeGetAvailableComponentTypes',
    // Assets
    'assetQuery', 'assetGetTree', 'assetGetAtPath', 'assetResolvePath', 'assetCreate', 'assetOperate',
    // Editor
    'editorSelect', 'editorHistory', 'editorEnvInfo',
    // Execute
    'executeJavascript',
    // Files
    'projectReadFile', 'projectWriteFile', 'projectSearchFiles',
    // UI
    'createUiNode',
    // Diagnostics
    'runScriptDiagnostics',
]);

export function isToolExposed(toolName: string, activeProfile: ToolProfile, enabledTools?: Set<string>, disabledTools?: Set<string>): boolean {
    // Custom profile: check enabled/disabled lists
    if (activeProfile === 'custom') {
        if (disabledTools?.has(toolName)) return false;
        if (enabledTools?.has(toolName)) return true;
        return CORE_TOOLS.has(toolName); // default to core set
    }

    // Full profile: everything exposed unless explicitly disabled
    if (activeProfile === 'full') {
        return !disabledTools?.has(toolName);
    }

    // Core profile: only core tools unless explicitly enabled
    if (disabledTools?.has(toolName)) return false;
    if (enabledTools?.has(toolName)) return true;
    return CORE_TOOLS.has(toolName);
}
