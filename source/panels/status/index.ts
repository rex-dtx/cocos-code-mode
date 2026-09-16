import packageJSON from '../../../package.json';

interface Status {
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableText(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isStatus(value: unknown): value is Status {
    if (!isRecord(value)) return false;
    const { checkedAt, build, server, registry, http, probe } = value;
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
            && (probe.sceneReady === null || typeof probe.sceneReady === 'boolean') && isNullableText(probe.code)));
}
interface StatusPanel {
    $: { check: HTMLButtonElement; state: HTMLElement; checked: HTMLElement; groups: HTMLElement; root: HTMLElement };
}
interface PanelState {
    closed: boolean;
    pending: boolean;
    generation: number;
    snapshot: Status | null;
    cancel?: () => void;
}
const states = new WeakMap<StatusPanel, PanelState>();
const unavailable = 'Unavailable';
const registryLabels = { matched: 'Matched this instance', missing: 'Missing', mismatch: 'Mismatch', error: 'Error', 'not-running': 'Not checked — server stopped' };
const httpLabels = { ok: 'Verified this instance', error: 'Error', 'not-running': 'Not checked — server stopped' };

function render(panel: StatusPanel, snapshot: Status | null): void {
    const build = snapshot?.build;
    const server = snapshot?.server;
    const probe = snapshot?.probe;
    const groups: Array<[string, Array<[string, string | null | undefined]>]> = [
        ['Extension & build', [
            ['Extension', packageJSON.name], ['Version', build?.version], ['Commit', build?.commit],
            ['Branch', build?.branch], ['Working tree', build ? (build.dirty ? 'Modified at build time' : 'Clean at build time') : null], ['Built at', build?.builtAt],
        ]],
        ['Project & editor', [['Project path', snapshot?.projectPath], ['Creator version', snapshot?.editorVersion]]],
        ['Server', [
            ['State', server ? (server.running ? 'Running' : 'Stopped') : null], ['Port', server ? String(server.port) : null],
            ['Instance ID', server?.instanceId], ['Namespace', server?.namespace], ['URL', server?.url],
            ['Debug logging', server ? (server.debug ? 'Enabled' : 'Disabled') : null],
        ]],
        ['UTCP registry', [
            ['State', snapshot ? registryLabels[snapshot.registry.status] : null], ['Path', snapshot?.registry.path], ['Detail', snapshot?.registry.detail],
        ]],
        ['HTTP handshake', [['State', snapshot ? httpLabels[snapshot.http.status] : null], ['Detail', snapshot?.http.detail]]],
        ['Scene probe', [
            ['Status', probe?.status ?? (server && !server.running ? 'Not checked — server stopped' : 'Unavailable — no verified probe')],
            ['Scene ready', probe?.sceneReady === null || probe?.sceneReady === undefined ? null : (probe.sceneReady ? 'Yes' : 'No')], ['Code', probe?.code],
        ]],
    ];
    const document = panel.$.groups.ownerDocument;
    const fragment = document.createDocumentFragment();
    for (const [heading, rows] of groups) {
        const section = document.createElement('section');
        const title = document.createElement('h2');
        title.textContent = heading;
        const list = document.createElement('dl');
        for (const [label, value] of rows) {
            const term = document.createElement('dt');
            term.textContent = label;
            const detail = document.createElement('dd');
            detail.textContent = value?.trim() || unavailable;
            list.append(term, detail);
        }
        section.append(title, list);
        fragment.append(section);
    }
    panel.$.groups.replaceChildren(fragment);
}

async function checkStatus(panel: StatusPanel): Promise<void> {
    const state = states.get(panel);
    if (!state || state.closed || state.pending) return;
    state.pending = true;
    const generation = ++state.generation;
    panel.$.check.disabled = true;
    panel.$.root.setAttribute('aria-busy', 'true');
    panel.$.state.dataset.kind = 'pending';
    panel.$.state.textContent = state.snapshot ? 'Checking status… Previous snapshot shown below.' : 'Checking status…';
    let timer: NodeJS.Timeout | undefined;
    try {
        const deadline = new Promise<never>((_resolve, reject) => {
            state.cancel = () => reject(new Error('Panel closed.'));
            timer = setTimeout(() => reject(new Error('No response within 4 seconds. Try Check Status again.')), 4000);
        });
        const request: Promise<unknown> = Promise.resolve().then(() => Editor.Message.request(packageJSON.name, 'extension-status'));
        const response = await Promise.race([request, deadline]);
        if (state.closed || state.generation !== generation) return;
        if (!isStatus(response)) throw new Error('The extension returned an invalid status response.');
        state.snapshot = response;
        render(panel, response);
        panel.$.checked.textContent = `Last checked: ${new Date(response.checkedAt).toLocaleString()}`;
        const hasError = response.registry.status === 'error' || response.registry.status === 'mismatch' || response.registry.status === 'missing' || response.http.status === 'error';
        panel.$.state.dataset.kind = hasError ? 'warning' : 'checked';
        panel.$.state.textContent = !response.server.running ? 'Check complete — server stopped.' : hasError ? 'Check complete — issues reported below.' : 'Check complete. See each check below.';
    } catch (error: unknown) {
        if (state.closed || state.generation !== generation) return;
        panel.$.state.dataset.kind = 'error';
        const detail = error instanceof Error ? error.message : String(error);
        panel.$.state.textContent = `${state.snapshot ? 'Check failed — previous snapshot is stale.' : 'Check failed — status unavailable.'} ${detail}`;
    } finally {
        clearTimeout(timer);
        if (!state.closed && state.generation === generation) {
            state.cancel = undefined;
            state.pending = false;
            panel.$.check.disabled = false;
            panel.$.root.setAttribute('aria-busy', 'false');
        }
    }
}

export const statusPanelDefinition = {
    template: `<main id="status-root">
        <header><div><h1>CC Bridge 3x</h1><p class="subtitle">Extension status</p></div><button id="check" type="button">Check Status</button></header>
        <div class="check-summary"><p id="state" role="status" aria-live="polite">Status not checked.</p><p id="checked">Not checked yet</p></div>
        <p class="note">Snapshot only; no automatic polling. HTTP checks verify this editor instance, not agent connectivity.</p>
        <div id="groups"></div>
    </main>`,
    style: `:host { display: block; height: 100%; color: #e1e3e8; background: #25262b; font: 13px/1.5 sans-serif; }
        * { box-sizing: border-box; } #status-root { height: 100%; overflow: auto; padding: 16px; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        h1 { font-size: 19px; line-height: 1.3; margin: 0; } .subtitle { margin: 3px 0 0; color: #aeb4c0; }
        button { font: inherit; color: #fff; background: #365e96; border: 1px solid #6386b8; border-radius: 4px; padding: 7px 11px; cursor: pointer; }
        button:hover:not(:disabled) { background: #436fa9; } button:focus-visible { outline: 2px solid #9ec9ff; outline-offset: 3px; }
        button:disabled { opacity: .6; cursor: wait; } .check-summary { margin-top: 16px; padding: 10px 12px; background: #30333b; border-radius: 5px; }
        #state { margin: 0; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
        #state[data-kind="error"], #state[data-kind="warning"] { color: #ffca95; } #state[data-kind="pending"] { color: #a9d0ff; }
        #checked { margin: 4px 0 0; font-size: 12px; color: #b8beca; } .note { color: #aeb4c0; font-size: 12px; margin: 12px 0 16px; }
        section { border: 1px solid #444852; border-radius: 5px; margin: 0 0 12px; overflow: hidden; }
        h2 { font-size: 13px; margin: 0; padding: 8px 11px; background: #30333b; }
        dl { display: grid; grid-template-columns: minmax(85px, 30%) minmax(0, 1fr); gap: 7px 12px; padding: 11px; margin: 0; }
        dt { color: #aeb4c0; } dd { margin: 0; color: #e1e3e8; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }`,
    $: { check: '#check', state: '#state', checked: '#checked', groups: '#groups', root: '#status-root' },
    ready() {
        const panel = this as unknown as StatusPanel;
        states.set(panel, { closed: false, pending: false, generation: 0, snapshot: null });
        render(panel, null);
        panel.$.check.onclick = () => { void checkStatus(panel); };
        void checkStatus(panel);
    },
    close() {
        const panel = this as unknown as StatusPanel;
        const state = states.get(panel);
        if (state) {
            state.closed = true;
            ++state.generation;
            state.cancel?.();
            states.delete(panel);
        }
        panel.$.check.onclick = null;
    },
};

module.exports = Editor.Panel.define(statusPanelDefinition);
