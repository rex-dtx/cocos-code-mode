import packageJSON from '../../../package.json';

export interface StatusSession {
    sessionId: string; label: string | null; transport: 'http-helper' | 'code-mode';
    lastSeen: number; ageMs: number; status: 'Active' | 'Stale' | 'Expired';
}

export interface StatusActivity {
    activeCount: number;
    active: Array<{ requestId: string; tool: string; startedAt: number; ageMs: number }>;
    overflowCount: number;
    lastFinished: { requestId: string; tool: string; outcome: 'completed' | 'failed'; status: number; finishedAt: number; durationMs: number } | null;
}

export interface Status {
    checkedAt: number;
    build: { version: string; commit: string; branch: string; dirty: boolean; builtAt: string };
    projectPath: string | null;
    editorVersion: string | null;
    server: {
        running: boolean; port: number; instanceId: string | null;
        namespace: string | null; url: string | null; debug: boolean;
    };
    registry: { path: string; status: 'matched' | 'missing' | 'mismatch' | 'error' | 'not-running'; detail: string | null };
    http: { status: 'ok' | 'error' | 'not-running'; detail: string | null };
    probe: { status: string; sceneReady: boolean | null; code: string | null } | null;
    sessions: StatusSession[];
    activity: StatusActivity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableText(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}
function isStatusActivity(value: unknown): value is StatusActivity {
    if (!isRecord(value) || typeof value.activeCount !== 'number' || !Number.isInteger(value.activeCount) || value.activeCount < 0
        || !Array.isArray(value.active) || value.active.length > 20
        || !value.active.every((entry) => isRecord(entry)
            && typeof entry.requestId === 'string' && entry.requestId.length > 0 && entry.requestId.length <= 32
            && typeof entry.tool === 'string' && entry.tool.length > 0 && entry.tool.length <= 128
            && typeof entry.startedAt === 'number' && Number.isInteger(entry.startedAt) && entry.startedAt > 0
            && typeof entry.ageMs === 'number' && Number.isFinite(entry.ageMs) && entry.ageMs >= 0)
        || typeof value.overflowCount !== 'number' || !Number.isInteger(value.overflowCount) || value.overflowCount < 0) return false;
    return value.lastFinished === null || (isRecord(value.lastFinished)
        && typeof value.lastFinished.requestId === 'string' && value.lastFinished.requestId.length > 0 && value.lastFinished.requestId.length <= 32
        && typeof value.lastFinished.tool === 'string' && value.lastFinished.tool.length > 0 && value.lastFinished.tool.length <= 128
        && (value.lastFinished.outcome === 'completed' || value.lastFinished.outcome === 'failed')
        && typeof value.lastFinished.status === 'number' && Number.isInteger(value.lastFinished.status) && value.lastFinished.status >= 100 && value.lastFinished.status <= 599
        && typeof value.lastFinished.finishedAt === 'number' && Number.isInteger(value.lastFinished.finishedAt) && value.lastFinished.finishedAt > 0
        && typeof value.lastFinished.durationMs === 'number' && Number.isInteger(value.lastFinished.durationMs) && value.lastFinished.durationMs >= 0);
}

export function isStatus(value: unknown): value is Status {
    if (!isRecord(value)) return false;
    const { checkedAt, build, server, registry, http, probe, sessions, activity } = value;
    return typeof checkedAt === 'number' && Number.isInteger(checkedAt) && checkedAt > 0 && checkedAt <= 8640000000000000
        && isRecord(build) && typeof build.version === 'string' && typeof build.commit === 'string'
        && typeof build.branch === 'string' && typeof build.dirty === 'boolean' && typeof build.builtAt === 'string'
        && isNullableText(value.projectPath) && isNullableText(value.editorVersion)
        && isRecord(server) && typeof server.running === 'boolean'
        && typeof server.port === 'number' && Number.isInteger(server.port) && server.port >= 0 && server.port <= 65535
        && isNullableText(server.instanceId) && isNullableText(server.namespace) && isNullableText(server.url) && typeof server.debug === 'boolean'
        && isRecord(registry) && typeof registry.path === 'string' && isNullableText(registry.detail)
        && (registry.status === 'matched' || registry.status === 'missing' || registry.status === 'mismatch' || registry.status === 'error' || registry.status === 'not-running')
        && isRecord(http) && (http.status === 'ok' || http.status === 'error' || http.status === 'not-running') && isNullableText(http.detail)
        && (probe === null || (isRecord(probe) && typeof probe.status === 'string'
            && (probe.sceneReady === null || typeof probe.sceneReady === 'boolean') && isNullableText(probe.code)))
        && Array.isArray(sessions) && sessions.length <= 100 && sessions.every((session) => isRecord(session)
            && typeof session.sessionId === 'string' && session.sessionId.length > 0 && session.sessionId.length <= 128
            && isNullableText(session.label) && (session.label === null || session.label.length <= 256)
            && (session.transport === 'http-helper' || session.transport === 'code-mode')
            && typeof session.lastSeen === 'number' && Number.isFinite(session.lastSeen)
            && typeof session.ageMs === 'number' && Number.isFinite(session.ageMs) && session.ageMs >= 0
            && (session.status === 'Active' || session.status === 'Stale' || session.status === 'Expired'))
        && isStatusActivity(activity);
}
const registryLabels = { matched: 'Matched this instance', missing: 'Missing', mismatch: 'Mismatch', error: 'Error', 'not-running': 'Not checked — server stopped' };
const httpLabels = { ok: 'Verified this instance', error: 'Error', 'not-running': 'Not checked — server stopped' };
export function renderStatus(container: HTMLElement, snapshot: Status | null): void {
    const build = snapshot?.build;
    const server = snapshot?.server;
    const probe = snapshot?.probe;
    const sessionRows: Array<[string, string]> = [['Meaning', 'Caller-reported heartbeat presence, not model activity or verified Code Mode connectivity. Check Status to refresh.']];
    if (!snapshot?.sessions.length) sessionRows.push(['Sessions', 'No session heartbeat observed']);
    for (const session of snapshot?.sessions ?? []) {
        sessionRows.push([session.label || session.sessionId,
            `${session.status} — ${session.transport} (caller-reported)\nSession: ${session.sessionId}\nLast seen: ${new Date(session.lastSeen).toLocaleString()}\nAge: ${Math.floor(session.ageMs / 1000)}s`]);
    }
    const activeSessionCount = snapshot?.sessions.filter((session) => session.status === 'Active').length ?? 0;
    const staleSessionCount = snapshot?.sessions.filter((session) => session.status === 'Stale').length ?? 0;
    const expiredSessionCount = snapshot?.sessions.filter((session) => session.status === 'Expired').length ?? 0;
    const activityRows: Array<[string, string]> = snapshot ? [
        ['State', snapshot.activity.activeCount > 0 ? `Processing — ${snapshot.activity.activeCount} request${snapshot.activity.activeCount === 1 ? '' : 's'}` : 'Ready · Idle'],
        ['Active requests', `${snapshot.activity.activeCount}${snapshot.activity.overflowCount ? ` (+${snapshot.activity.overflowCount} hidden)` : ''}`],
        ['Sessions', `${activeSessionCount} active · ${staleSessionCount} stale · ${expiredSessionCount} expired`],
    ] : [['State', 'Unavailable']];
    if (snapshot?.activity.lastFinished) {
        const last = snapshot.activity.lastFinished;
        activityRows.push(['Last request', `${last.tool} · ${last.outcome} · ${last.durationMs}ms`]);
    }
    const groups: Array<[string, Array<[string, string | null | undefined]>]> = [
        ['Operational status', activityRows],
        ['Session connections', sessionRows],
        ['Server', [
            ['State', server ? (server.running ? 'Running' : 'Stopped') : null],
            ['Port', server ? String(server.port) : null], ['URL', server?.url],
        ]],
        ['Project & editor', [['Project path', snapshot?.projectPath], ['Creator version', snapshot?.editorVersion]]],
        ['HTTP handshake', [['State', snapshot ? httpLabels[snapshot.http.status] : null], ['Detail', snapshot?.http.detail]]],
        ['Scene probe', [
            ['Status', probe?.status ?? (server && !server.running ? 'Not checked — server stopped' : 'Unavailable — no verified probe')],
            ['Scene ready', probe?.sceneReady === null || probe?.sceneReady === undefined ? null : (probe.sceneReady ? 'Yes' : 'No')], ['Code', probe?.code],
        ]],
        ['Technical details', [
            ['Extension', packageJSON.name], ['Version', build?.version], ['Commit', build?.commit],
            ['Branch', build?.branch], ['Working tree', build ? (build.dirty ? 'Modified at build time' : 'Clean at build time') : null], ['Built at', build?.builtAt],
            ['Instance ID', server?.instanceId], ['Namespace', server?.namespace],
            ['Registry state', snapshot ? registryLabels[snapshot.registry.status] : null], ['Registry path', snapshot?.registry.path], ['Registry detail', snapshot?.registry.detail],
        ]],
    ];
    const document = container.ownerDocument;
    const fragment = document.createDocumentFragment();
    const expanded = container.querySelector('details')?.open ?? false;
    for (const [heading, rows] of groups) {
        const technical = heading === 'Technical details';
        const section = document.createElement(technical ? 'details' : 'section');
        if (technical) (section as HTMLDetailsElement).open = expanded;
        const title = document.createElement(technical ? 'summary' : 'h2');
        title.textContent = heading;
        const list = document.createElement('dl');
        for (const [label, value] of rows) {
            const term = document.createElement('dt');
            term.textContent = label;
            const detail = document.createElement('dd');
            detail.textContent = value?.trim() || 'Unavailable';
            list.append(term, detail);
        }
        section.append(title, list);
        fragment.append(section);
    }
    container.replaceChildren(fragment);
}
