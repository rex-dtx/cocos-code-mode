import { ToolError } from '../tool-error';

export interface GameViewRuntime {
    running: boolean;
    paused: boolean | null;
    timeScale: number | null;
    frameCount: number | null;
    sceneUuid: string;
    webContentsId: number | null;
    platform: string;
    enabled: boolean;
    ready: boolean;
    loaded: boolean;
    failed: boolean;
}

interface HostContents {
    id: number;
    getURL(): string;
    getType(): string;
    isDestroyed(): boolean;
    executeJavaScript(source: string): Promise<unknown>;
}
interface ElectronHost {
    BrowserWindow: { getAllWindows(): Array<{ webContents: HostContents }> };
    webContents: { fromId(id: number): HostContents | undefined };
}
interface PreviewHost {
    platform: string;
    enabled: boolean;
    ready: boolean;
    loaded: boolean;
    failed: boolean;
    webContentsId: number | null;
}

// Creator 3.7.3 host adapter. These fixed scripts never contain caller input.
const HOST_INSPECTION = `(() => {
    const views = [];
    function visit(root) {
        for (const element of root.querySelectorAll('*')) {
            if (element.tagName === 'ENGINE-VIEW' && element.previewClient && element.getClientRects().length) {
                const client = element.previewClient;
                views.push({ platform: element._platform, enabled: element._isPreviewEnabled,
                    ready: client.isPreviewReady, loaded: client._loaded, failed: client.isPreviewFailed,
                    webContentsId: client._loaded && client.webview ? client.webview.getWebContentsId() : null });
            }
            if (element.shadowRoot) visit(element.shadowRoot);
        }
    }
    visit(document);
    return views;
})()`;
const RUNTIME_INSPECTION = `(() => {
    const cc = globalThis.cc;
    const director = cc && cc.director;
    const game = cc && cc.game;
    const scheduler = director && director.getScheduler && director.getScheduler();
    const frameCount = director && (typeof director.totalFrames === 'number' ? director.totalFrames : director.getTotalFrames && director.getTotalFrames());
    return { gameView: !!cc && cc.GAME_VIEW === true,
        sceneUuid: director && director.getScene() && director.getScene().uuid,
        phase: globalThis.cce && cce.PreviewPlay && cce.PreviewPlay._state,
        paused: game && game.isPaused && game.isPaused(),
        timeScale: scheduler && scheduler.getTimeScale ? scheduler.getTimeScale() : null,
        frameCount: typeof frameCount === 'number' ? frameCount : null };
})()`;
const LIFECYCLE_DISPATCH = (enabled: boolean): string => `(() => {
    const views = [];
    function visit(root) {
        for (const element of root.querySelectorAll('*')) {
            if (element.tagName === 'ENGINE-VIEW' && element.previewClient && element.getClientRects().length) views.push(element);
            if (element.shadowRoot) visit(element.shadowRoot);
        }
    }
    visit(document);
    if (views.length !== 1) return false;
    const view = views[0];
    const client = view.previewClient;
    if (typeof view.previewSetPlay === 'function') void view.previewSetPlay(${enabled ? 'true' : 'false'});
    else if (client && typeof client.previewSetPlay === 'function') void client.previewSetPlay(${enabled ? 'true' : 'false'});
    else return false;
    return true;
})()`;

function creatorMainWindow(electron: ElectronHost): { webContents: HostContents } {
    const windows = electron.BrowserWindow.getAllWindows().filter(({ webContents }) => {
        if (webContents.isDestroyed()) return false;
        try {
            const url = new URL(webContents.getURL());
            return url.protocol === 'file:' && url.pathname.replace(/\\/g, '/').endsWith('/@editor/creator/static/windows/main.html');
        } catch { return false; }
    });
    if (windows.length !== 1) throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Expected exactly one Creator project main window.' });
    return windows[0];
}

export async function dispatchGameViewLifecycle(enabled: boolean): Promise<void> {
    const electron = require('electron') as ElectronHost;
    const dispatched = await creatorMainWindow(electron).webContents.executeJavaScript(LIFECYCLE_DISPATCH(enabled));
    if (dispatched !== true) throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Creator game-view host did not accept the bounded lifecycle dispatch.' });
}


export async function inspectGameViewRuntime(): Promise<GameViewRuntime> {
    const electron = require('electron') as ElectronHost;
    const mainWindow = creatorMainWindow(electron);
    const candidates = await mainWindow.webContents.executeJavaScript(HOST_INSPECTION);
    if (!Array.isArray(candidates) || candidates.length !== 1) throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Expected exactly one visible Creator game-view host.' });
    const host = candidates[0] as Partial<PreviewHost>;
    if (typeof host.platform !== 'string' || typeof host.enabled !== 'boolean' || typeof host.ready !== 'boolean' || typeof host.loaded !== 'boolean' || typeof host.failed !== 'boolean') {
        throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Creator game-view host shape differs from the 3.7.3 adapter.' });
    }
    const stopped: GameViewRuntime = { platform: host.platform, enabled: host.enabled, ready: host.ready, loaded: host.loaded, failed: host.failed, running: false, paused: null, timeScale: null, frameCount: null, sceneUuid: '', webContentsId: null };
    if (!host.enabled) return stopped;
    if (host.platform !== 'gameView' || !host.ready || !host.loaded || host.failed || !Number.isSafeInteger(host.webContentsId)) throw new ToolError({ code: 'RUNTIME_NOT_READY', status: 409, message: 'Enabled game-view transport is not ready.' });
    const target = electron.webContents.fromId(host.webContentsId!);
    if (!target || target.isDestroyed() || target.getType() !== 'webview' || !/preload(?:%5[Cc]|\\|\/)preview(?:%5[Cc]|\\|\/)preload\.js/.test(target.getURL())) {
        throw new ToolError({ code: 'UNSUPPORTED_RUNTIME_TRANSPORT', status: 422, message: 'Creator preview host does not identify its game-view renderer.' });
    }
    const value = await target.executeJavaScript(RUNTIME_INSPECTION) as Record<string, unknown> | null;
    if (!value || value.gameView !== true || !['play', 'pause'].includes(String(value.phase)) || typeof value.sceneUuid !== 'string' || !value.sceneUuid) throw new ToolError({ code: 'RUNTIME_NOT_READY', status: 409, message: 'Actual game-view renderer has no consistent running scene.' });
    const paused = value.phase === 'pause';
    const after = await mainWindow.webContents.executeJavaScript(HOST_INSPECTION) as PreviewHost[];
    if (!Array.isArray(after) || after.length !== 1 || !after[0].enabled || !after[0].ready || after[0].failed || after[0].webContentsId !== target.id) throw new ToolError({ code: 'RUNTIME_TARGET_CHANGED', status: 409, message: 'Game-view renderer changed during inspection.' });
    return { ...stopped, running: true, paused, sceneUuid: value.sceneUuid, webContentsId: target.id,
        timeScale: typeof value.timeScale === 'number' && Number.isFinite(value.timeScale) ? value.timeScale : null,
        frameCount: typeof value.frameCount === 'number' && Number.isSafeInteger(value.frameCount) && value.frameCount >= 0 ? value.frameCount : null };
}
