import { isMessageNotExposed } from './utils/editor-message-error';
import { queryEditorMessage } from './editor-state';
import { classifyPopupWindows } from './editor-popup-classifier';
import { readElectronWindowSnapshot } from './electron-window-snapshot';
import { observeWindowsPopups } from './windows-popup-observer';
import {
    CreatorDialogSignal,
    EditorPopupInspectArgs,
    EditorPopupInspectResult,
    PopupWindowObservation,
} from './editor-popup-contracts';
import { controlNumber, controlObject, invalidControl } from './editor-control-validation';

const MAX_POPUP_ITEMS = 32;
const DEFAULT_POPUP_ITEMS = 16;
const CREATOR_DIALOG_TIMEOUT_MS = 500;
const DESKTOP_CAPTURER_TIMEOUT_MS = 500;

interface ElectronObservation {
    observations: PopupWindowObservation[];
    raceDetected: boolean;
}

function isCreatorMainUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'file:' && parsed.pathname.replace(/\\/g, '/').endsWith('/@editor/creator/static/windows/main.html');
    } catch {
        return false;
    }
}

function isDevToolsWindow(url: string, type: string, title: string): boolean {
    return type === 'devtools' || url.startsWith('devtools://') || /devtools/i.test(title);
}

function isWorkerWindow(url: string, type: string, title: string): boolean {
    return type === 'backgroundPage' || type === 'worker' || /(?:^|[\\/])worker(?:[\\/]|$)/i.test(url) || /worker/i.test(title);
}

function readElectronWindows(includeHidden: boolean): ElectronObservation {
    const snapshot = readElectronWindowSnapshot();
    const windows = includeHidden ? snapshot.windows : snapshot.windows.filter(window => window.visible);
    const creatorMain = snapshot.windows.find(window => isCreatorMainUrl(window.url));
    const observations = windows.map(window => {
        const creatorMainWindow = isCreatorMainUrl(window.url);
        const devtools = !creatorMainWindow && isDevToolsWindow(window.url, window.type, window.title);
        const worker = !creatorMainWindow && !devtools && isWorkerWindow(window.url, window.type, window.title);
        const ownerVerified = creatorMainWindow || (creatorMain !== undefined && (window.parent === creatorMain.window || window.parentId === creatorMain.id));
        return {
            source: 'electron' as const,
            id: `electron:${window.id}`,
            title: window.title,
            visible: window.visible,
            focused: window.focused,
            modal: window.modal,
            parentId: window.parentId === null ? null : `electron:${window.parentId}`,
            ownerVerified,
            bounds: window.bounds,
            signals: [
                ...(creatorMainWindow ? ['creator-main-url'] : []),
                ...(devtools ? ['devtools-type-or-url'] : []),
                ...(worker ? ['worker-type-or-url'] : []),
            ],
            content: { text: null, source: null, truncated: false },
            actions: [],
            classificationEvidence: { creatorMain: creatorMainWindow, devtools, worker },
        };
    });
    return { observations, raceDetected: snapshot.raceDetected };
}

interface CreatorDialogProbe {
    signal: CreatorDialogSignal;
    failed: boolean;
}

async function readCreatorDialog(): Promise<CreatorDialogProbe> {
    try {
        const timer = new Promise<never>((_, reject) => {
            const handle = setTimeout(() => reject(new Error('Creator dialog probe deadline exceeded.')), CREATOR_DIALOG_TIMEOUT_MS);
            handle.unref?.();
        });
        const value = await Promise.race([queryEditorMessage('information', 'has-dialog'), timer]);
        if (typeof value !== 'boolean') return { signal: { available: false, open: null, source: null }, failed: true };
        return { signal: { available: true, open: value, source: 'information/has-dialog' }, failed: false };
    } catch (error) {
        if (isMessageNotExposed(error, 'information', 'has-dialog')) {
            return { signal: { available: false, open: null, source: null }, failed: true };
        }
        return { signal: { available: false, open: null, source: null }, failed: true };
    }
}

async function readDesktopCapturer(): Promise<{ available: boolean, failed: boolean }> {
    try {
        const electron = require('electron') as { desktopCapturer?: { getSources?: (options: unknown) => Promise<unknown[]> } };
        if (!electron.desktopCapturer || typeof electron.desktopCapturer.getSources !== 'function') return { available: false, failed: true };
        const timer = new Promise<never>((_, reject) => {
            const handle = setTimeout(() => reject(new Error('Desktop capturer probe deadline exceeded.')), DESKTOP_CAPTURER_TIMEOUT_MS);
            handle.unref?.();
        });
        const sources = await Promise.race([
            electron.desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }),
            timer,
        ]);
        return { available: Array.isArray(sources), failed: !Array.isArray(sources) };
    } catch {
        return { available: false, failed: true };
    }
}

function validateArgs(input: EditorPopupInspectArgs): { includeNative: boolean, includeHidden: boolean, maxItems: number } {
    const args = controlObject(input, ['includeNative', 'includeHidden', 'maxItems']);
    if (args.includeNative !== undefined && typeof args.includeNative !== 'boolean') invalidControl('includeNative must be a boolean.');
    if (args.includeHidden !== undefined && typeof args.includeHidden !== 'boolean') invalidControl('includeHidden must be a boolean.');
    const maxItems = args.maxItems === undefined ? DEFAULT_POPUP_ITEMS : controlNumber(args.maxItems, 'maxItems', 1, MAX_POPUP_ITEMS);
    return { includeNative: args.includeNative === true, includeHidden: args.includeHidden === true, maxItems };
}

async function readNativeWindows(includeNative: boolean, includeHidden: boolean, maxItems: number, electron: ElectronObservation): Promise<{ observations: PopupWindowObservation[], complete: boolean }> {
    if (!includeNative || process.platform !== 'win32') return { observations: [], complete: true };
    const creatorMain = electron.observations.find(window => window.classificationEvidence.creatorMain === true);
    return observeWindowsPopups({
        processId: process.pid,
        creatorMainBounds: creatorMain?.bounds ?? null,
        creatorMainTitle: creatorMain?.title ?? '',
        includeHidden,
        maxItems,
    });
}

export async function inspectEditorPopups(input: EditorPopupInspectArgs = {}): Promise<EditorPopupInspectResult> {
    const args = validateArgs(input);
    const unavailable: EditorPopupInspectResult['unavailable'] = [];
    let complete = true;

    const firstDialog = await readCreatorDialog();
    const creatorDialog = firstDialog.signal;
    if (firstDialog.failed) {
        unavailable.push('creator-dialog-ipc');
        complete = false;
    }

    let electron: ElectronObservation = { observations: [], raceDetected: false };
    try {
        electron = readElectronWindows(args.includeHidden);
    } catch {
        unavailable.push('electron-browser-window');
        complete = false;
    }

    const desktopCapturer = await readDesktopCapturer();
    if (desktopCapturer.failed) {
        unavailable.push('electron-desktop-capturer');
        complete = false;
    }

    let nativeObservations: PopupWindowObservation[] = [];
    try {
        const native = await readNativeWindows(args.includeNative, args.includeHidden, args.maxItems, electron);
        nativeObservations = native.observations;
        complete = complete && native.complete;
    } catch {
        if (args.includeNative && process.platform === 'win32') {
            unavailable.push('windows-native');
            complete = false;
        }
    }

    const secondDialog = await readCreatorDialog();
    const latestDialog = secondDialog.signal.available || !creatorDialog.available ? secondDialog.signal : creatorDialog;
    if (secondDialog.failed && creatorDialog.available) {
        unavailable.push('creator-dialog-ipc');
        complete = false;
    }
    const raceDetected = electron.raceDetected || (creatorDialog.available && secondDialog.signal.available && creatorDialog.open !== secondDialog.signal.open);


    const result = classifyPopupWindows(latestDialog, [...electron.observations, ...nativeObservations], {
        maxItems: args.maxItems,
        complete,
        unavailable,
        raceDetected,
    });
    result.capturedAt = Date.now();
    return result;
}

export { readElectronWindows };
