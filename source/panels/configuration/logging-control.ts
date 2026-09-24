import packageJSON from '../../../package.json';

// Shared across panel reopen: an unresolved write must never be submitted twice.
let pendingWrite: Promise<unknown> | null = null;

type Tier = 'summary' | 'trace';
type Group = 'protocol' | 'read' | 'behavior' | 'lifecycle';
type Groups = Record<Group, boolean>;
interface LoggingState {
    enabled: boolean;
    tier: Tier;
    groups: Groups;
    scene: string;
    logFile: string | null;
}

const groupNames: Group[] = ['protocol', 'read', 'behavior', 'lifecycle'];
const defaultGroups = (): Groups => ({ protocol: false, read: true, behavior: true, lifecycle: true });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const boundedText = (value: string, limit = 500): string => value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

export function attachLoggingControl(root: HTMLElement): () => void {
    const toggle = root.querySelector<HTMLButtonElement>('#verbose-toggle')!;
    const refresh = root.querySelector<HTMLButtonElement>('#verbose-refresh')!;
    const policyControls = root.querySelector<HTMLFieldSetElement>('#verbose-policy-controls')!;
    const tierSelect = root.querySelector<HTMLSelectElement>('#verbose-tier')!;
    const groupInputs = Object.fromEntries(groupNames.map(group => [group, root.querySelector<HTMLInputElement>(`#verbose-group-${group}`)!])) as Record<Group, HTMLInputElement>;
    const feedback = root.querySelector<HTMLElement>('#verbose-feedback')!;
    let closed = false;
    let busy = false;
    let state: LoggingState | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const render = () => {
        if (closed) return;
        const disabled = busy || state === null || pendingWrite !== null;
        toggle.disabled = disabled;
        refresh.disabled = busy || pendingWrite !== null;
        policyControls.disabled = disabled;
        toggle.textContent = state === null ? 'Verbose logs: unavailable' : `Turn verbose logs ${state.enabled ? 'OFF' : 'ON'}`;
        toggle.setAttribute('aria-pressed', String(state?.enabled === true));
        if (state) {
            tierSelect.value = state.tier;
            for (const group of groupNames) groupInputs[group].checked = state.groups[group];
        }
    };
    const describe = (value: unknown): LoggingState | null => {
        if (!isRecord(value) || typeof value.enabled !== 'boolean') return null;
        const policy = isRecord(value.policy) ? value.policy : value;
        const tierValue = policy.tier;
        if (tierValue !== undefined && tierValue !== 'summary' && tierValue !== 'trace') return null;
        const groups = defaultGroups();
        if (policy.groups !== undefined) {
            if (!isRecord(policy.groups)) return null;
            for (const group of groupNames) {
                if (policy.groups[group] !== undefined && typeof policy.groups[group] !== 'boolean') return null;
                if (typeof policy.groups[group] === 'boolean') groups[group] = policy.groups[group] as boolean;
            }
        }
        return {
            enabled: value.enabled,
            tier: (tierValue ?? 'summary') as Tier,
            groups,
            scene: typeof value.scene === 'string' ? value.scene : 'unknown',
            logFile: typeof value.logFile === 'string' ? value.logFile : null,
        };
    };
    const policyPayload = (enabled: boolean): Record<string, unknown> => ({
        enabled,
        tier: state?.tier ?? 'summary',
        groups: { ...(state?.groups ?? defaultGroups()) },
    });
    const describeFeedback = (next: LoggingState): string => {
        const enabled = next.enabled ? 'ON' : 'OFF';
        const groups = groupNames.filter(group => next.groups[group]).join(', ') || 'none';
        const scene = next.scene === 'enabled' ? ' Scene capture: ON.' : next.scene === 'disabled' ? ' Scene capture: OFF.' : ` Scene capture: ${next.scene}.`;
        const file = next.logFile ? ' Log file: available.' : '';
        return boundedText(`Verbose logs ${enabled}. Tier: ${next.tier}. Groups: ${groups}.${scene}${file} Warnings/errors always visible.`);
    };
    const observe = async (request: Promise<unknown>, writing: boolean) => {
        busy = true;
        render();
        feedback.textContent = writing ? 'Updating verbose logging policy…' : 'Reading verbose logging state…';
        let expired = false;
        const timer = setTimeout(() => {
            expired = true;
            timers.delete(timer);
            if (closed) return;
            state = null;
            feedback.textContent = writing
                ? 'Update timed out; outcome unknown. Waiting for the original request; do not retry.'
                : 'Reading logging state timed out. Refresh to retry.';
            if (!writing) busy = false;
            render();
        }, 4000);
        timers.add(timer);
        try {
            const next = describe(await request);
            if (!next) throw new Error('Invalid logging state response.');
            state = next;
            feedback.textContent = describeFeedback(next);
        } catch (error) {
            if (!closed && !(expired && !writing)) {
                state = null;
                feedback.textContent = boundedText(`Logging state not confirmed: ${error instanceof Error ? error.message : String(error)} Refresh before another change.`);
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
    const write = (enabled = state?.enabled ?? false) => {
        if (closed || busy || state === null || pendingWrite) return;
        const request: Promise<unknown> = Promise.resolve().then(() => Editor.Message.request(packageJSON.name, 'set-debug-logging', policyPayload(enabled)));
        pendingWrite = request;
        void request.then(() => { if (pendingWrite === request) pendingWrite = null; }, () => { if (pendingWrite === request) pendingWrite = null; });
        void observe(request, true);
    };
    const onTierChange = () => {
        if (!state || busy || pendingWrite) return;
        state.tier = tierSelect.value === 'trace' ? 'trace' : 'summary';
        write(state.enabled);
    };
    const onGroupChange = () => {
        if (!state || busy || pendingWrite) return;
        for (const group of groupNames) state.groups[group] = groupInputs[group].checked;
        write(state.enabled);
    };
    const onToggle = () => write(!(state?.enabled ?? false));
    toggle.addEventListener('click', onToggle);
    refresh.addEventListener('click', read);
    tierSelect.addEventListener('change', onTierChange);
    for (const group of groupNames) groupInputs[group].addEventListener('change', onGroupChange);
    if (pendingWrite) void observe(pendingWrite, true);
    else read();
    return () => {
        closed = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        toggle.removeEventListener('click', onToggle);
        refresh.removeEventListener('click', read);
        tierSelect.removeEventListener('change', onTierChange);
        for (const group of groupNames) groupInputs[group].removeEventListener('change', onGroupChange);
    };
}
