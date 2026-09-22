export interface ElectronBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ElectronWindowSnapshotRecord {
    window: any;
    id: string;
    numericId: number | null;
    title: string;
    visible: boolean;
    focused: boolean | null;
    modal: boolean | null;
    parent: any | null;
    parentId: string | null;
    bounds: ElectronBounds | null;
    url: string;
    type: string;
}

export interface ElectronWindowSnapshot {
    windows: ElectronWindowSnapshotRecord[];
    raceDetected: boolean;
}

type ElectronWindowApi = {
    getAllWindows(): any[];
    getFocusedWindow?(): any;
};

function safeCall<T>(callback: () => T, fallback: T): T {
    try {
        return callback();
    } catch {
        return fallback;
    }
}

function safeString(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function readId(window: any): { id: string, numericId: number | null } | null {
    const value = window?.id;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return { id: String(value), numericId: value };
    if (typeof value === 'string' && value.length > 0 && value.length <= 128) return { id: value, numericId: null };
    return null;
}

function readBounds(window: any): ElectronBounds | null {
    if (!window || typeof window.getBounds !== 'function') return null;
    const value = safeCall(() => window.getBounds(), null);
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.width) || !Number.isFinite(value.height)) return null;
    return { x: Math.round(value.x), y: Math.round(value.y), width: Math.max(0, Math.round(value.width)), height: Math.max(0, Math.round(value.height)) };
}

function readUrl(window: any): string {
    const contents = window?.webContents;
    return contents && typeof contents.getURL === 'function' ? safeCall(() => safeString(contents.getURL(), 2048), '') : '';
}

function readType(window: any): string {
    const contents = window?.webContents;
    return contents && typeof contents.getType === 'function' ? safeCall(() => safeString(contents.getType(), 128), '') : '';
}

function loadBrowserWindow(): ElectronWindowApi {
    let electron: { BrowserWindow?: ElectronWindowApi };
    try {
        electron = require('electron') as { BrowserWindow?: ElectronWindowApi };
    } catch {
        throw new Error('Electron BrowserWindow API is unavailable.');
    }
    if (!electron.BrowserWindow || typeof electron.BrowserWindow.getAllWindows !== 'function') {
        throw new Error('Electron BrowserWindow API is unavailable.');
    }
    return electron.BrowserWindow;
}

function ids(windows: any[]): string[] {
    return windows.map(window => readId(window)?.id).filter((id): id is string => id !== undefined).sort((left, right) => left.localeCompare(right));
}

export function readElectronWindowSnapshot(): ElectronWindowSnapshot {
    const BrowserWindow = loadBrowserWindow();
    const initialWindows = BrowserWindow.getAllWindows();
    const focusedWindow = typeof BrowserWindow.getFocusedWindow === 'function' ? safeCall(() => BrowserWindow.getFocusedWindow!(), null) : null;
    const windows: ElectronWindowSnapshotRecord[] = [];
    let raceDetected = false;

    for (const window of initialWindows) {
        try {
            if (window?.webContents?.isDestroyed?.() === true) {
                raceDetected = true;
                continue;
            }
            const identity = readId(window);
            if (!identity) {
                raceDetected = true;
                continue;
            }
            const parent = typeof window.getParentWindow === 'function' ? safeCall(() => window.getParentWindow(), null) : null;
            const parentIdentity = parent ? readId(parent) : null;
            windows.push({
                window,
                id: identity.id,
                numericId: identity.numericId,
                title: typeof window.getTitle === 'function' ? safeCall(() => safeString(window.getTitle(), 256), '') : '',
                visible: typeof window.isVisible === 'function' ? safeCall(() => window.isVisible() === true, false) : false,
                focused: focusedWindow === null ? null : window === focusedWindow,
                modal: typeof window.isModal === 'function' ? safeCall(() => window.isModal() === true, null) : null,
                parent,
                parentId: parentIdentity ? parentIdentity.id : null,
                bounds: readBounds(window),
                url: readUrl(window),
                type: readType(window),
            });
        } catch {
            raceDetected = true;
        }
    }

    try {
        const finalWindows = BrowserWindow.getAllWindows();
        const initialIds = ids(initialWindows);
        const finalIds = ids(finalWindows);
        if (initialIds.length !== finalIds.length || initialIds.some((id, index) => id !== finalIds[index])) raceDetected = true;
    } catch {
        raceDetected = true;
    }

    return { windows, raceDetected };
}
