export const AUDIO_TARGETS = ['web-mobile', 'web-desktop', 'native-mobile', 'native-desktop'] as const;
export type AudioTarget = typeof AUDIO_TARGETS[number];

export type AudioIssueCode = 'ASSET_NOT_FOUND' | 'TYPE_MISMATCH' | 'UNSUPPORTED_FORMAT' | 'UNKNOWN_METADATA' | 'IMPORT_FAILED' | 'TARGET_UNSUPPORTED';
export interface AudioAssetReference { id: string; type: 'cc.AudioClip'; }
export interface AudioAssetInfo {
    uuid?: unknown;
    type?: unknown;
    url?: unknown;
    source?: unknown;
    path?: unknown;
    file?: unknown;
    importer?: unknown;
    loadMode?: unknown;
    audioLoadMode?: unknown;
    importerSettings?: Record<string, unknown>;
    imported?: unknown;
    invalid?: unknown;
    meta?: { importer?: unknown; userData?: Record<string, unknown> };
}
export interface AudioAuditEntry { reference: AudioAssetReference; info: AudioAssetInfo | null; }
export interface AudioCompatibilityIssue {
    code: AudioIssueCode;
    assetId: string;
    field?: string;
    value?: unknown;
    message: string;
}
export interface AudioCompatibilityItem {
    reference: AudioAssetReference;
    target: AudioTarget;
    valid: boolean;
    url?: string;
    path?: string;
    extension?: string;
    importer?: string;
    loadMode?: string;
    issues: AudioCompatibilityIssue[];
}
export interface AudioCompatibilityAuditResult {
    target: AudioTarget;
    valid: boolean;
    complete: boolean;
    items: AudioCompatibilityItem[];
    issues: AudioCompatibilityIssue[];
}

// browser support, duration, or decode success from a file extension.
const CREATOR_AUDIO_EXTENSIONS: Record<string, true> = { '.ogg': true, '.mp3': true, '.wav': true, '.mp4': true, '.m4a': true };

const TARGET_AUDIO_EXTENSIONS: Record<AudioTarget, Record<string, true>> = {
    'web-mobile': { '.ogg': true, '.mp3': true, '.wav': true },
    'web-desktop': { ...CREATOR_AUDIO_EXTENSIONS },
    'native-mobile': { ...CREATOR_AUDIO_EXTENSIONS },
    'native-desktop': { ...CREATOR_AUDIO_EXTENSIONS },
};

function exposedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizePath(value: unknown): string | undefined {
    const raw = exposedString(value);
    if (!raw) return undefined;
    return raw.replace(/\\/g, '/').replace(/[?#].*$/, '');
}

function extensionFrom(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const match = /(?:^|\/)[^/]*\.([a-z0-9]+)$/i.exec(value);
    return match ? `.${match[1].toLowerCase()}` : undefined;
}

function normalizeLoadMode(info: AudioAssetInfo): { value?: string; exposed: boolean } {
    const settings = info.importerSettings;
    const userData = info.meta?.userData;
    const candidates: unknown[] = [
        info.loadMode,
        info.audioLoadMode,
        settings && settings.loadMode,
        settings && settings.audioLoadMode,
        userData && userData.loadMode,
        userData && userData.audioLoadMode,
    ];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const raw = exposedString(candidate);
        if (!raw) return { exposed: true };
        const key = raw.toLowerCase().replace(/[_.\s]/g, '-');
        if (key.includes('dom-audio') || key === 'domaudio') return { value: 'dom-audio', exposed: true };
        if (key.includes('web-audio') || key === 'webaudio') return { value: 'web-audio', exposed: true };
        return { value: raw, exposed: true };
    }
    return { exposed: false };
}

function issue(code: AudioIssueCode, assetId: string, message: string, field?: string, value?: unknown): AudioCompatibilityIssue {
    return { code, assetId, ...(field ? { field } : {}), ...(value === undefined ? {} : { value }), message };
}

export function buildAudioAssetCompatibilityAudit(
    target: AudioTarget,
    entries: AudioAuditEntry[],
    maxIssues = 256,
): AudioCompatibilityAuditResult {
    const allIssues: AudioCompatibilityIssue[] = [];
    const items = entries.map(({ reference, info }) => {
        const itemIssues: AudioCompatibilityIssue[] = [];
        if (!info) {
            itemIssues.push(issue('ASSET_NOT_FOUND', reference.id, `Asset ${reference.id} was not found in the public asset database.`));
            allIssues.push(...itemIssues);
            return { reference, target, valid: false, issues: itemIssues };
        }
        const actualType = exposedString(info.type);
        if (actualType !== 'cc.AudioClip') {
            itemIssues.push(issue('TYPE_MISMATCH', reference.id, `Asset ${reference.id} is ${actualType ?? 'unknown'}, not cc.AudioClip.`, 'type', actualType ?? null));
        }
        const url = normalizePath(info.url ?? info.source);
        const path = normalizePath(info.path ?? info.file);
        const extension = extensionFrom(url) ?? extensionFrom(path);
        const importer = exposedString(info.importer) ?? exposedString(info.meta?.importer);
        const loadMode = normalizeLoadMode(info);
        if (actualType === 'cc.AudioClip') {
            if (info.invalid === true || info.imported === false) itemIssues.push(issue('IMPORT_FAILED', reference.id, `Asset ${reference.id} is invalid or not fully imported.`, info.invalid === true ? 'invalid' : 'imported', info.invalid === true ? true : false));
            if (!extension) itemIssues.push(issue('UNKNOWN_METADATA', reference.id, `Asset ${reference.id} does not expose a source extension.`, 'extension'));
            else if (!CREATOR_AUDIO_EXTENSIONS[extension]) itemIssues.push(issue('UNSUPPORTED_FORMAT', reference.id, `Asset ${reference.id} uses unsupported audio format ${extension}.`, 'extension', extension));
            else if (!TARGET_AUDIO_EXTENSIONS[target][extension]) itemIssues.push(issue('TARGET_UNSUPPORTED', reference.id, `Asset ${reference.id} format ${extension} is not supported for target ${target}.`, 'target', target));
            if (!importer) itemIssues.push(issue('UNKNOWN_METADATA', reference.id, `Asset ${reference.id} does not expose importer metadata.`, 'importer'));
            if (loadMode.exposed && !loadMode.value) itemIssues.push(issue('UNKNOWN_METADATA', reference.id, `Asset ${reference.id} exposes an unrecognized audio load mode.`, 'loadMode'));
        }
        allIssues.push(...itemIssues);
        return {
            reference,
            target,
            valid: itemIssues.length === 0,
            ...(url ? { url } : {}),
            ...(path ? { path } : {}),
            ...(extension ? { extension } : {}),
            ...(importer ? { importer } : {}),
            ...(loadMode.value ? { loadMode: loadMode.value } : {}),
            issues: itemIssues,
        };
    });
    const limit = Math.max(1, Math.min(Math.floor(maxIssues), 256));
    const issues = allIssues.slice(0, limit);
    let remaining = issues.length;
    const boundedItems = items.map((item) => {
        const visibleIssues = item.issues.slice(0, remaining);
        remaining -= visibleIssues.length;
        return { ...item, issues: visibleIssues };
    });
    return { target, valid: allIssues.length === 0, complete: issues.length === allIssues.length, items: boundedItems, issues };
}
