import packageJSON from '../../../package.json';

// Shared across panel reopen: an unresolved write must never be submitted twice.
let pendingWrite: Promise<unknown> | null = null;

export function attachLoggingControl(root: HTMLElement): () => void {
    const toggle = root.querySelector<HTMLButtonElement>('#verbose-toggle')!;
    const refresh = root.querySelector<HTMLButtonElement>('#verbose-refresh')!;
    const feedback = root.querySelector<HTMLElement>('#verbose-feedback')!;
    let closed = false;
    let busy = false;
    let enabled: boolean | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const render = () => {
        if (closed) return;
        toggle.disabled = busy || enabled === null || pendingWrite !== null;
        refresh.disabled = busy || pendingWrite !== null;
        toggle.textContent = enabled === null ? 'Verbose logs: unavailable' : `Turn verbose logs ${enabled ? 'OFF' : 'ON'}`;
        toggle.setAttribute('aria-pressed', String(enabled === true));
    };
    const describe = (value: unknown): { enabled: boolean; scene: string; logFile: string | null } | null => {
        if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean') return null;
        const record = value as Record<string, unknown>;
        return { enabled: value.enabled, scene: typeof record.scene === 'string' ? record.scene : 'unknown', logFile: typeof record.logFile === 'string' ? record.logFile : null };
    };
    const observe = async (request: Promise<unknown>, writing: boolean) => {
        busy = true;
        render();
        feedback.textContent = writing ? 'Updating verbose logs…' : 'Reading verbose logging state…';
        let expired = false;
        const timer = setTimeout(() => {
            expired = true;
            timers.delete(timer);
            if (closed) return;
            enabled = null;
            feedback.textContent = writing
                ? 'Update timed out; outcome unknown. Waiting for the original request; do not retry.'
                : 'Reading logging state timed out. Refresh to retry.';
            if (!writing) busy = false;
            render();
        }, 4000);
        timers.add(timer);
        try {
            const value = await request;
            const state = describe(value);
            if (!state) throw new Error('Invalid logging state response.');
            enabled = state.enabled;
            const scene = state.scene === 'enabled' ? ' Scene console capture is ON.' : state.scene === 'disabled' ? ' Scene console capture is OFF.' : ` Scene console capture: ${state.scene}.`;
            const file = state.logFile ? ` Log file: ${state.logFile}` : '';
            feedback.textContent = `Verbose logs ${enabled ? 'ON' : 'OFF'}.${scene}${file}`;
        } catch {
            if (!closed && !(expired && !writing)) {
                enabled = null;
                feedback.textContent = 'Logging state not confirmed. Refresh before another change.';
            }
        } finally {
            clearTimeout(timer);
            timers.delete(timer);
            if (!(expired && !writing)) { busy = false; render(); }
        }
    };
    const read = () => {
        if (closed || busy || pendingWrite) return;
        void observe(Promise.resolve().then(() => Editor.Message.request(packageJSON.name, 'get-debug-logging')), false);
    };
    const write = () => {
        if (closed || busy || enabled === null || pendingWrite) return;
        const desired = !enabled;
        const request: Promise<unknown> = Promise.resolve().then(() => Editor.Message.request(packageJSON.name, 'set-debug-logging', desired));
        pendingWrite = request;
        void request.then(() => { if (pendingWrite === request) pendingWrite = null; }, () => { if (pendingWrite === request) pendingWrite = null; });
        void observe(request, true);
    };
    toggle.addEventListener('click', write);
    refresh.addEventListener('click', read);
    if (pendingWrite) void observe(pendingWrite, true);
    else read();
    return () => {
        closed = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        toggle.removeEventListener('click', write);
        refresh.removeEventListener('click', read);
    };
}
