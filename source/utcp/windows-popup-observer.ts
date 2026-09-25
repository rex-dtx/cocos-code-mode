import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PopupActionRecord, PopupBounds, PopupWindowObservation } from './editor-popup-contracts';
import { getTrackedPopupFixture } from './editor-popup-fixture';

const NATIVE_TIMEOUT_MS = 1000;
const NATIVE_MAX_ITEMS = 32;
const MAX_STDOUT_BYTES = 64 * 1024;

interface NativeActionRow { hwnd: string; label: string; enabled: boolean }
interface NativeContent { text: string | null; source: 'native-control' | null; truncated: boolean }
interface NativeWindowRow { hwnd: string; pid: number; visible: boolean; title: string; className: string; ownerHwnd: string | null; rootOwnerHwnd: string | null; bounds: PopupBounds | null; actions: NativeActionRow[]; content: NativeContent }
interface NativeProbeOutput { windows: NativeWindowRow[] }
export interface NativeWindowContext { processId: number; creatorMainBounds: PopupBounds | null; creatorMainTitle: string; includeHidden: boolean; maxItems: number }
export interface NativeWindowObservationResult { observations: PopupWindowObservation[]; complete: boolean }

function boundedText(value: unknown, maximum: number): string { return typeof value === 'string' ? value.slice(0, maximum) : ''; }
function boundedHwnd(value: unknown): string | null { return typeof value === 'string' && /^0x[0-9A-F]+$/i.test(value) ? value.toUpperCase() : null; }
function boundedBounds(value: unknown): PopupBounds | null {
    if (!value || typeof value !== 'object') return null;
    const c = value as Record<string, unknown>;
    if (![c.x, c.y, c.width, c.height].every(Number.isFinite)) return null;
    return { x: Math.round(c.x as number), y: Math.round(c.y as number), width: Math.max(0, Math.round(c.width as number)), height: Math.max(0, Math.round(c.height as number)) };
}
function overlapArea(a: PopupBounds, b: PopupBounds): number {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
function boundedContent(value: unknown): NativeContent {
    if (!value || typeof value !== 'object') return { text: null, source: null, truncated: false };
    const record = value as Record<string, unknown>;
    const textValue = typeof record.text === 'string' ? record.text.slice(0, 4096) : null;
    return { text: textValue, source: textValue ? 'native-control' : null, truncated: record.truncated === true };
}
function normalizedRows(value: unknown, processId: number): NativeWindowRow[] {
    if (!value || typeof value !== 'object' || !Array.isArray((value as NativeProbeOutput).windows)) throw new Error('Python native popup probe returned invalid JSON.');
    return (value as NativeProbeOutput).windows.slice(0, NATIVE_MAX_ITEMS).flatMap(row => {
        if (!row || typeof row !== 'object' || row.pid !== processId || typeof row.visible !== 'boolean') return [];
        const hwnd = boundedHwnd(row.hwnd);
        if (!hwnd) return [];
        const actions = Array.isArray(row.actions) ? row.actions.slice(0, 16).flatMap(action => {
            const childHwnd = boundedHwnd(action?.hwnd);
            return childHwnd && typeof action?.enabled === 'boolean' ? [{ hwnd: childHwnd, label: boundedText(action.label, 256), enabled: action.enabled }] : [];
        }) : [];
        return [{ hwnd, pid: processId, visible: row.visible, title: boundedText(row.title, 256), className: boundedText(row.className, 256), ownerHwnd: boundedHwnd(row.ownerHwnd), rootOwnerHwnd: boundedHwnd(row.rootOwnerHwnd), bounds: boundedBounds(row.bounds), actions, content: boundedContent(row.content) }];
    });
}
export function classifyNativeWindows(rows: NativeWindowRow[], context: NativeWindowContext): PopupWindowObservation[] {
    const visible = rows.filter(row => row.visible);
    const fixture = getTrackedPopupFixture();
    const matchingFixtures = fixture ? visible.filter(row => row.className === '#32770' && row.title === fixture.title && row.ownerHwnd === null && row.rootOwnerHwnd === row.hwnd && row.actions.length === 2 && row.actions.some(action => action.label === 'Continue' && action.enabled) && row.actions.some(action => action.label === 'Cancel' && action.enabled)) : [];
    const main = rows.find(row => row.className === 'Chrome_WidgetWin_1' && row.title === context.creatorMainTitle);
    const mainHwnd = main?.hwnd ?? null;
    const trackedHwnd = matchingFixtures.length === 1 && mainHwnd ? matchingFixtures[0].hwnd : null;
    return rows.filter(row => context.includeHidden || row.visible).map(row => {
        const dialogClass = row.className === '#32770';
        const creatorMain = !dialogClass && row.hwnd === mainHwnd && row.className === 'Chrome_WidgetWin_1' && row.title === context.creatorMainTitle;
        const trackedFixture = row.hwnd === trackedHwnd;
        const ownerVerified = creatorMain || (mainHwnd !== null && (row.ownerHwnd === mainHwnd || row.rootOwnerHwnd === mainHwnd)) || trackedFixture;
        const actions: PopupActionRecord[] = row.visible && ownerVerified && dialogClass ? row.actions.map(action => ({ id: `native:${row.pid}:${action.hwnd}`, label: action.label, enabled: action.enabled })) : [];
        const content = row.visible && ownerVerified && dialogClass ? row.content : { text: null, source: null, truncated: false };
        return { source: 'native' as const, id: `native:${row.pid}:${row.hwnd}`, title: row.title, visible: row.visible, focused: null, modal: creatorMain ? false : ownerVerified || (dialogClass && row.visible), parentId: trackedFixture ? `native:${row.pid}:${mainHwnd}` : row.ownerHwnd ? `native:${row.pid}:${row.ownerHwnd}` : null, ownerVerified, bounds: row.bounds, signals: [...(creatorMain ? ['creator-main-bounds'] : []), ...(ownerVerified && !creatorMain ? ['native-owner'] : []), ...(trackedFixture ? ['tracked-creator-fixture'] : []), ...(dialogClass ? ['native-dialog-class'] : []), `native-class:${row.className}`], content, actions, classificationEvidence: { creatorMain } };
    });
}
function probePath(): string { return path.resolve(__dirname, '../../static/native-popup-probe.py'); }
function resolvePython(): { command: string, prefix: string[] } {
    const candidates: Array<[string, string[]]> = process.platform === 'win32' ? [['python', []], ['py', ['-3']]] : [['python3', []], ['python', []]];
    for (const [command, prefix] of candidates) {
        try {
            require('child_process').execFileSync(command, [...prefix, '-c', 'import sys; assert sys.version_info >= (3, 8)'], { stdio: 'ignore', timeout: 500 });
            return { command, prefix };
        } catch {}
    }
    throw new Error('Python 3.8+ runtime is required for native popup inspection.');
}
export async function observeWindowsPopups(context: NativeWindowContext): Promise<NativeWindowObservationResult> {
    if (process.platform !== 'win32') return { observations: [], complete: true };
    const python = resolvePython();
    const maxItems = Math.min(Math.max(context.maxItems, 1), NATIVE_MAX_ITEMS);
    const stdout = await new Promise<string>((resolve, reject) => execFile(python.command, [...python.prefix, probePath(), String(context.processId)], { timeout: NATIVE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: MAX_STDOUT_BYTES }, (error, output) => error ? reject(error) : resolve(output)));
    return { observations: classifyNativeWindows(normalizedRows(JSON.parse(stdout), context.processId), context), complete: true };
}
export async function activateWindowsPopupAction(popupId: string, actionId: string, popupTitle: string, actionLabel: string, ownerId: string, ownerTitle: string, ownerClass: string, expectedContent: { text: string | null; source: 'native-control' | null; truncated: boolean }): Promise<{ activated: boolean, closed: boolean }> {
    if (process.platform !== 'win32') throw new Error('Windows native popup actions are unavailable.');
    const popup = /^native:(\d+):(0X[0-9A-F]+)$/i.exec(popupId);
    const action = /^native:(\d+):(0X[0-9A-F]+)$/i.exec(actionId);
    const owner = /^native:(\d+):(0X[0-9A-F]+)$/i.exec(ownerId);
    if (!popup || !action || !owner || popup[1] !== action[1] || popup[1] !== owner[1] || Number(popup[1]) !== process.pid || popupTitle.length > 256 || actionLabel.length > 256 || ownerTitle.length > 256 || ownerClass !== 'Chrome_WidgetWin_1') throw new Error('Popup or action identity is invalid.');
    const python = resolvePython();
    const content = JSON.stringify(expectedContent);
    const args = [...python.prefix, probePath(), String(process.pid), popup[2].toUpperCase(), action[2].toUpperCase(), popupTitle, actionLabel, owner[2].toUpperCase(), ownerTitle, ownerClass, content];
    const stdout = await new Promise<string>((resolve, reject) => execFile(python.command, args, { timeout: NATIVE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: MAX_STDOUT_BYTES }, (error, output) => error ? reject(error) : resolve(output)));
    const result = JSON.parse(stdout) as { activated?: unknown, closed?: unknown };
    if (result.activated !== true || result.closed !== true) throw new Error('Native popup action did not prove closure.');
    return { activated: true, closed: true };
}
