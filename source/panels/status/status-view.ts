import packageJSON from '../../../package.json';

export interface StatusSession {
    sessionId: string; label: string | null; transport: 'http-helper' | 'code-mode';
    lastSeen: number; ageMs: number; status: 'Active' | 'Stale' | 'Expired';
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableText(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

export function isStatus(value: unknown): value is Status {
    if (!isRecord(value)) return false;
    const { checkedAt, build, server, registry, http, probe, sessions } = value;
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
            && (session.status === 'Active' || session.status === 'Stale' || session.status === 'Expired'));
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
    const groups: Array<[string, Array<[string, string | null | undefined]>]> = [
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
