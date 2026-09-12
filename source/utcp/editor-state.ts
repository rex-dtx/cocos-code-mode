import { EditorStateArgs, EditorStateResult } from './editor-control-contracts';
import { controlNumber, controlObject } from './editor-control-validation';
import { listEditorTasks } from './editor-control-plane';
import { getEditorPrompt } from './editor-prompt';

// A hung Creator IPC must not accumulate new requests on each snapshot poll.
const inFlight = new Map<string, Promise<unknown>>();
function query(channel: string, message: string): Promise<unknown> {
    const key = `${channel}:${message}`;
    let pending = inFlight.get(key);
    if (!pending) {
        // Creator 3.7's Node runtime does not support Promise.withResolvers.
        pending = new Promise((resolve, reject) => {
            // Settle subscribers even if IPC never resolves. Keep the slot occupied
            // until the real request settles, so later polls cannot pile up IPC.
            const timer = setTimeout(() => reject(new Error('Scene query deadline exceeded.')), 5000);
            timer.unref?.();
            Promise.resolve().then(() => Editor.Message.request(channel, message)).then(value => {
                clearTimeout(timer);
                inFlight.delete(key);
                resolve(value);
            }, error => {
                clearTimeout(timer);
                inFlight.delete(key);
                reject(error);
            });
        });
        inFlight.set(key, pending);
    }
    return pending;
}
function boundedText(value: unknown, maximum: number): string | null {
    return typeof value === 'string' ? value.slice(0, maximum) : null;
}
export async function getEditorState(input: EditorStateArgs = {}): Promise<EditorStateResult> {
    const args = controlObject(input, ['timeoutMs']);
    const timeoutMs = args.timeoutMs === undefined ? 1000 : controlNumber(args.timeoutMs, 'timeoutMs', 1, 5000);
    const result: EditorStateResult = {
        capturedAt: 0, projectPath: boundedText(Editor.Project?.path, 4096), engineVersion: null,
        scene: { ready: null, dirty: null, current: null }, busy: { scene: null, assetImport: null, build: null, tasks: false, inbox: false },
        tasks: { running: 0, cancellationRequested: 0, retained: 0 },
        inbox: { pending: false, requestId: null, kind: null, expiresAt: null }, unavailable: [],
    };
    const available = new Set<string>();
    let finished = false;
    const queries = [
        ['scene.ready', 'scene', 'query-is-ready'], ['scene.dirty', 'scene', 'query-dirty'], ['scene.current', 'scene', 'query-current-scene'],
        ['busy.assetImport', 'asset-db', 'is-busy'], ['busy.build', 'builder', 'query-tasks-info'], ['engineVersion', 'engine', 'query-info'],
    ];
    const reads = queries.map(([key, channel, message]) => query(channel, message).then(value => {
        if (finished) return;
        if (key === 'scene.current') {
            if (value === null || value === '') { available.add(key); return; }
            const current = typeof value === 'string' ? { uuid: value } : value;
            if (!current || typeof current !== 'object') return;
            const fields = current as Record<string, unknown>;
            if (!['uuid', 'url', 'name'].some(field => typeof fields[field] === 'string')) return;
            result.scene.current = { uuid: boundedText(fields.uuid, 256), url: boundedText(fields.url, 4096), name: boundedText(fields.name, 256) };
        } else if (key === 'engineVersion') {
            const version = (value as { version?: unknown } | null)?.version;
            if (typeof version !== 'string' || !version) return;
            result.engineVersion = version.slice(0, 256);
        } else if (key === 'busy.build') {
            const free = (value as { free?: unknown } | null)?.free;
            if (typeof free !== 'boolean') return;
            result.busy.build = !free;
        } else {
            if (typeof value !== 'boolean') return;
            if (key === 'scene.ready') result.scene.ready = value;
            else if (key === 'scene.dirty') result.scene.dirty = value;
            else result.busy.assetImport = value;
        }
        available.add(key);
    }, () => {}));
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([Promise.all(reads), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    } finally { finished = true; clearTimeout(timer); }
    if (result.projectPath === null) result.unavailable.push('projectPath');
    for (const [key] of queries) if (!available.has(key)) result.unavailable.push(key);
    const listed = listEditorTasks({ limit: 100 });
    result.tasks = {
        running: listed.tasks.filter(task => task.status === 'running').length,
        cancellationRequested: listed.tasks.filter(task => task.status === 'running' && task.cancelRequested).length,
        retained: listed.total,
    };
    const prompt = getEditorPrompt();
    if (prompt) result.inbox = { pending: true, requestId: prompt.requestId, kind: prompt.kind, expiresAt: prompt.expiresAt };
    result.busy.scene = result.scene.ready === null ? null : !result.scene.ready;
    result.busy.tasks = result.tasks.running > 0;
    result.busy.inbox = !!prompt;
    result.capturedAt = Date.now();
    return result;
}
