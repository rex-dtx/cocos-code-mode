// Shared by server lifecycle events and editorLog; updated by the user toggle.
export let debugEnabled = process.env.UTCP_DEBUG === '1' || process.env.UTCP_DEBUG === 'true';

export function setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
}

export type CreatorLogGroup = 'protocol' | 'read' | 'behavior' | 'lifecycle';
export type CreatorLogTier = 'critical' | 'summary' | 'trace';
export interface CreatorLogPolicy {
    tier: CreatorLogTier;
    groups: Record<CreatorLogGroup, boolean>;
}

export function defaultCreatorLogPolicy(): CreatorLogPolicy {
    return { tier: 'summary', groups: { protocol: false, read: true, behavior: true, lifecycle: true } };
}

let creatorLogPolicy = defaultCreatorLogPolicy();

export function getCreatorLogPolicy(): CreatorLogPolicy {
    return { tier: creatorLogPolicy.tier, groups: { ...creatorLogPolicy.groups } };
}

/** Saved preferences may be absent or stale; never let them silently hide ordinary tool logs. */
export function parseCreatorLogPolicy(value: unknown): CreatorLogPolicy {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultCreatorLogPolicy();
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).some(key => key !== 'tier' && key !== 'groups')
        || !['critical', 'summary', 'trace'].includes(candidate.tier as string)
        || !candidate.groups || typeof candidate.groups !== 'object' || Array.isArray(candidate.groups)) return defaultCreatorLogPolicy();
    const groups = candidate.groups as Record<string, unknown>;
    const names: CreatorLogGroup[] = ['protocol', 'read', 'behavior', 'lifecycle'];
    if (Object.keys(groups).length !== names.length || names.some(name => typeof groups[name] !== 'boolean')) return defaultCreatorLogPolicy();
    return { tier: candidate.tier as CreatorLogTier, groups: {
        protocol: groups.protocol as boolean, read: groups.read as boolean,
        behavior: groups.behavior as boolean, lifecycle: groups.lifecycle as boolean,
    } };
}

export function setCreatorLogPolicy(policy: CreatorLogPolicy): CreatorLogPolicy {
    creatorLogPolicy = parseCreatorLogPolicy(policy);
    return getCreatorLogPolicy();
}

export function isCreatorLogVisible(phase: unknown, group: CreatorLogGroup = 'read'): boolean {
    if (phase === 'error' || phase === 'warning') return true;
    if (!debugEnabled || creatorLogPolicy.tier === 'critical' || !creatorLogPolicy.groups[group]) return false;
    return phase !== 'start' && phase !== 'trace' || creatorLogPolicy.tier === 'trace';
}
