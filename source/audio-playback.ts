export type AudioPlaybackOperation = 'play' | 'pause' | 'stop' | 'seek' | 'observe';
export interface AudioPlaybackRequest {
    sessionId: string;
    targetId: string;
    nodeUuid: string;
    operation: AudioPlaybackOperation;
    time?: number;
    timeoutMs?: number;
}
export interface AudioPlaybackState {
    currentTime: number;
    duration: number;
    playing: boolean;
    playbackState: 'init' | 'playing' | 'paused' | 'stopped' | 'interrupted';
    loaded: boolean;
    userActivation: 'active' | 'inactive' | 'unknown';
    activationRequirement: 'unknown';
}
export interface AudioPlaybackSuccess {
    success: true;
    sessionId: string;
    targetId: string;
    nodeUuid: string;
    operation: AudioPlaybackOperation;
    state: AudioPlaybackState;
    started: boolean;
    ended: boolean;
}
export type AudioPlaybackResult = AudioPlaybackSuccess | {
    success: false;
    error: { code: string; message: string; status: number; state?: AudioPlaybackState; pendingMayComplete?: boolean };
};

interface AudioSourceHandle {
    currentTime: number; duration: number; playing: boolean; state: number; isValid?: boolean;
    clip: { isValid?: boolean } | null; _lastSetClip?: object | null; _isLoaded?: boolean; _player?: object;
    play(): void; pause(): void; stop(): void;
}
interface AudioSourceClass {
    AudioState: Record<'INIT' | 'PLAYING' | 'PAUSED' | 'STOPPED' | 'INTERRUPTED', number>;
    EventType: { STARTED: string; ENDED: string };
}
export interface AudioRuntimeNode {
    uuid: string; parent?: AudioRuntimeNode | null; isValid?: boolean;
    getComponents(type: AudioSourceClass): AudioSourceHandle[];
    on(event: string, callback: (source: unknown) => void): void;
    off(event: string, callback: (source: unknown) => void): void;
}
export interface AudioRuntimeEngine {
    GAME_VIEW?: boolean; director?: { getScene(): AudioRuntimeNode | null };
    AudioSource?: AudioSourceClass; js?: { getClassByName(name: string): AudioSourceClass | undefined };
}

const busy = new WeakSet<object>();
// Creator's public void methods cannot cancel a pending activation/player operation.
// Do not enqueue further commands on an uncertain source after our deadline.
const uncertain = new WeakSet<object>();
class AudioFailure extends Error {
    constructor(readonly code: string, message: string, readonly status = 422) { super(message); }
}
function requireCondition(value: unknown, code: string, message: string, status = 422): asserts value {
    if (!value) throw new AudioFailure(code, message, status);
}
function snapshot(source: AudioSourceHandle, AudioSource: AudioSourceClass): AudioPlaybackState {
    const currentTime = source.currentTime;
    const duration = source.duration;
    const playing = source.playing;
    const names = ['INIT', 'PLAYING', 'PAUSED', 'STOPPED', 'INTERRUPTED'] as const;
    const state = source.state;
    const name = names.find((key) => typeof AudioSource.AudioState?.[key] === 'number' && AudioSource.AudioState[key] === state);
    requireCondition(Number.isFinite(currentTime) && currentTime >= 0 && Number.isFinite(duration) && duration >= 0
        && typeof playing === 'boolean' && name && playing === (name === 'PLAYING'), 'AUDIO_STATE_UNAVAILABLE', 'AudioSource state readback is unavailable or inconsistent.');
    // Creator's scene process may not provide the browser UserActivation API.
    const host: { navigator?: { userActivation?: { isActive?: boolean } } } = globalThis;
    const active = host.navigator?.userActivation?.isActive;
    return { currentTime, duration, playing, playbackState: name!.toLowerCase() as AudioPlaybackState['playbackState'],
        // Version-pinned read-only guard: currentTime otherwise reports only a cached seek.
        loaded: source._isLoaded === true && !!source._player && source._lastSetClip === source.clip,
        userActivation: typeof active === 'boolean' ? (active ? 'active' : 'inactive') : 'unknown', activationRequirement: 'unknown' };
}

/** Creator 3.7.3 scene-preview only; all failures are JSON-safe across scene IPC. */
export async function executeAudioPlayback(
    request: AudioPlaybackRequest, cc: AudioRuntimeEngine, findNode: (id: string) => Promise<AudioRuntimeNode | null>,
): Promise<AudioPlaybackResult> {
    let source!: AudioSourceHandle;
    let locked = false;
    let node!: AudioRuntimeNode;
    let started = false;
    let ended = false;
    let listening = false;
    let events: AudioSourceClass['EventType'] | undefined;
    const onStarted = (component: unknown) => { if (component === source) started = true; };
    const onEnded = (component: unknown) => { if (component === source && started) ended = true; };
    try {
        requireCondition(request && ['play', 'pause', 'stop', 'seek', 'observe'].includes(request.operation), 'INVALID_ARGUMENT', 'Unknown audio operation.', 400);
        for (const key of ['sessionId', 'targetId', 'nodeUuid'] as const) {
            requireCondition(typeof request[key] === 'string' && request[key].trim() && request[key].length <= 256, 'INVALID_ARGUMENT', `${key} is required.`, 400);
        }
        const timeoutMs = request.timeoutMs ?? 1000;
        requireCondition(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 5000, 'INVALID_ARGUMENT', 'timeoutMs must be an integer from 100 to 5000.', 400);
        requireCondition(request.operation === 'seek' ? Number.isFinite(request.time) : request.time === undefined, 'INVALID_ARGUMENT', 'Only seek accepts a finite time in seconds.', 400);
        const scene = cc?.director?.getScene?.();
        const checkTarget = () => {
            requireCondition(cc?.GAME_VIEW === true, 'RUNTIME_NOT_READY', 'Audio requires the live Creator scene-preview context.', 409);
            requireCondition(scene && cc.director?.getScene() === scene && scene.uuid === request.targetId, 'RUNTIME_TARGET_CHANGED', 'The current scene does not match the attached runtime session.', 409);
        };
        checkTarget();
        const found = await findNode(request.nodeUuid);
        requireCondition(found && found.uuid === request.nodeUuid && found.isValid !== false, 'AUDIO_NODE_NOT_FOUND', 'The runtime audio node was not found.', 404);
        node = found;
        let root: AudioRuntimeNode | null | undefined = node;
        for (let depth = 0; root && root !== scene && depth < 2048; depth++) root = root.parent;
        requireCondition(root === scene, 'RUNTIME_TARGET_CHANGED', 'Audio node is outside the attached runtime scene.', 409);
        const AudioSource = cc.AudioSource ?? cc.js?.getClassByName?.('cc.AudioSource');
        requireCondition(AudioSource && typeof node.getComponents === 'function', 'AUDIO_API_UNAVAILABLE', 'AudioSource component lookup is unavailable.');
        const sources = node.getComponents(AudioSource);
        requireCondition(Array.isArray(sources) && sources.length === 1, 'AUDIO_COMPONENT_INVALID', 'The node must contain exactly one AudioSource.');
        source = sources[0];
        const clip = source.clip;
        requireCondition(source.isValid !== false && clip && clip.isValid !== false, 'AUDIO_CLIP_MISSING', 'AudioSource requires a valid assigned clip.');
        const read = () => {
            checkTarget();
            requireCondition(node.isValid !== false && source.isValid !== false && source.clip === clip && clip.isValid !== false, 'AUDIO_TARGET_CHANGED', 'The node, source, or clip changed during control.', 409);
            return snapshot(source, AudioSource);
        };
        let state = read();
        const success = (): AudioPlaybackSuccess => ({ success: true, sessionId: request.sessionId, targetId: request.targetId,
            nodeUuid: request.nodeUuid, operation: request.operation, state, started, ended });
        if (request.operation === 'observe') return success();
        requireCondition(!busy.has(source), 'AUDIO_CONTROL_BUSY', 'Another control is awaiting this source.', 409);
        requireCondition(!uncertain.has(source), 'AUDIO_CONTROL_UNCERTAIN', 'A prior operation timed out and may still complete; recreate the source or restart the preview before further control.', 409);
        requireCondition(state.loaded && state.duration > 0, 'AUDIO_NOT_READY', 'The AudioSource player has not finished loading a nonempty clip.', 409);
        if (request.operation === 'seek') {
            requireCondition(request.time! >= 0 && request.time! <= state.duration, 'AUDIO_SEEK_OUT_OF_RANGE', 'Seek time must be between zero and duration.', 400);
            let descriptor: PropertyDescriptor | undefined;
            for (let proto = source; proto && !descriptor; proto = Object.getPrototypeOf(proto)) descriptor = Object.getOwnPropertyDescriptor(proto, 'currentTime');
            requireCondition(descriptor && (typeof descriptor.set === 'function' || descriptor.writable === true), 'AUDIO_API_UNAVAILABLE', 'AudioSource.currentTime is not writable.');
        } else requireCondition(typeof source[request.operation] === 'function', 'AUDIO_API_UNAVAILABLE', `AudioSource.${request.operation} is unavailable.`);
        if (request.operation === 'play') {
            requireCondition(typeof node.on === 'function' && typeof node.off === 'function' && typeof AudioSource.EventType?.STARTED === 'string'
                && typeof AudioSource.EventType?.ENDED === 'string', 'AUDIO_API_UNAVAILABLE', 'AudioSource playback events are unavailable.');
        }
        // Known idempotent states require no engine operation (and cannot queue work).
        if ((request.operation === 'pause' && state.playbackState === 'paused')
            || (request.operation === 'stop' && state.playbackState === 'stopped' && state.currentTime === 0)
            || (request.operation === 'seek' && state.currentTime === request.time)) return success();
        const previousTime = state.currentTime;
        busy.add(source);
        locked = true;
        if (request.operation === 'play') {
            events = AudioSource.EventType;
            listening = true;
            node.on(events.STARTED, onStarted);
            node.on(events.ENDED, onEnded);
        }
        const deadline = Date.now() + timeoutMs;
        try {
            if (request.operation === 'seek') source.currentTime = request.time!;
            else source[request.operation]();
        } catch (error) { uncertain.add(source); throw error; }
        while (true) {
            state = read();
            const confirmed = request.operation === 'play' ? started && (state.playing || ended)
                : request.operation === 'pause' ? state.playbackState === 'paused' && !state.playing
                    : request.operation === 'stop' ? state.playbackState === 'stopped' && !state.playing && state.currentTime <= 0.001
                        : state.currentTime !== previousTime && Math.abs(state.currentTime - request.time!) <= 0.05;
            if (confirmed) return success();
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                uncertain.add(source);
                return { success: false, error: { code: request.operation === 'play' ? 'AUDIO_START_TIMEOUT' : 'AUDIO_CONTROL_TIMEOUT', status: 409,
                    message: 'Audio state was not confirmed before the deadline. Activation requirements are unknown; the engine operation may still complete.', state, pendingMayComplete: true } };
            }
            await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, remaining)));
        }
    } catch (error) {
        if (locked) uncertain.add(source);
        return { success: false, error: { code: error instanceof AudioFailure ? error.code : 'AUDIO_OPERATION_FAILED',
            status: error instanceof AudioFailure ? error.status : 500, message: error instanceof Error ? error.message : String(error),
            ...(locked ? { pendingMayComplete: true } : {}) } };
    } finally {
        if (listening && events) {
            node.off(events.STARTED, onStarted);
            node.off(events.ENDED, onEnded);
        }
        if (locked) busy.delete(source);
    }
}
