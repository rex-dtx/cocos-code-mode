import { utcpTool } from '../decorators';

// Input simulation via Electron's webContents.sendInputEvent.
// Requires the editor's main process to expose BrowserWindow / webContents
// (available in Creator's Electron shell). If unavailable, fails fast with a
// clear error so the agent knows this surface is editor-version gated.

function getTargetWindow(): any {
    let BrowserWindow: any;
    try {
        const electron = require('electron');
        BrowserWindow = electron.BrowserWindow;
    } catch (e: any) {
        throw new Error(`Electron not available in this context: ${e?.message || String(e)}`);
    }
    if (!BrowserWindow) throw new Error('Electron BrowserWindow not available');
    const wins: any[] = BrowserWindow.getAllWindows();
    const target = BrowserWindow.getFocusedWindow() || wins[0];
    if (!target) throw new Error('No Electron window found');
    const wc = target.webContents;
    if (!wc || typeof wc.sendInputEvent !== 'function') {
        throw new Error('webContents.sendInputEvent not available (editor 3.7.3 may not expose it)');
    }
    return target;
}

function getWebContents(): any {
    return getTargetWindow().webContents;
}

// Electron sendInputEvent shapes (keyEvent/mouseDown/mouseUp/mouseMove)
function modifiersOf(args: { shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean }): string[] {
    const mods: string[] = [];
    if (args.shift) mods.push('shift');
    if (args.ctrl || args.meta) mods.push('control'); // control covers ctrl/meta in Electron
    if (args.alt) mods.push('alt');
    return mods;
}

export class InputTools {

    @utcpTool(
        'simulateKeyPress',
        'Simulate a single key press (keyDown + keyUp) via Electron webContents.sendInputEvent on the focused editor window. Fails fast if the API is not available in this editor version.',
        {
            type: 'object',
            properties: {
                key:    { type: 'string', description: 'Key code, e.g. "A", "Enter", "Escape", "F5"' },
                modifiers: {
                    type: 'object',
                    properties: {
                        shift: { type: 'boolean' },
                        ctrl:  { type: 'boolean' },
                        alt:   { type: 'boolean' },
                        meta:  { type: 'boolean' },
                    },
                },
            },
            required: ['key'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                key:     { type: 'string' },
            },
            required: ['success'],
        },
        'POST',
        ['input', 'keyboard', 'key', 'simulate', 'press', 'shortcut']
    )
    async simulateKeyPress(args: { key: string, modifiers?: { shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean } }): Promise<{ success: boolean, key: string }> {
        if (!args.key?.trim()) throw new Error('simulateKeyPress requires key');
        const wc = getWebContents();
        const mods = args.modifiers ? modifiersOf(args.modifiers) : [];
        const keyCode = args.key;
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods });
        wc.sendInputEvent({ type: 'keyUp',   keyCode, modifiers: mods });
        return { success: true, key: args.key };
    }

    @utcpTool(
        'simulateKeyCombo',
        'Simulate a key combo (e.g. "Ctrl+D", "Ctrl+Shift+D") by parsing the combo string and emitting keyDown/Up for each part via webContents.sendInputEvent.',
        {
            type: 'object',
            properties: {
                combo: { type: 'string', description: 'Combo string like "Ctrl+Shift+D", "Ctrl+S", "Delete" — modifiers: Ctrl/Cmd/Shift/Alt' },
            },
            required: ['combo'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                combo:   { type: 'string' },
            },
            required: ['success'],
        },
        'POST',
        ['input', 'keyboard', 'combo', 'shortcut', 'hotkey', 'simulate']
    )
    async simulateKeyCombo(args: { combo: string }): Promise<{ success: boolean, combo: string }> {
        if (!args.combo?.trim()) throw new Error('simulateKeyCombo requires combo string');
        const parts = args.combo.split('+').map(p => p.trim()).filter(Boolean);
        if (!parts.length) throw new Error('simulateKeyCombo: empty combo');
        const mods = parts.slice(0, -1);
        const key  = parts[parts.length - 1];

        const electronMods: string[] = [];
        const MODIFIER_TOKENS: Record<string, string> = {
            ctrl: 'control', control: 'control', cmd: 'control', command: 'control', meta: 'control',
            shift: 'shift', alt: 'alt', option: 'alt',
        };
        for (const m of mods) {
            const lower = m.toLowerCase();
            const mapped = MODIFIER_TOKENS[lower];
            if (!mapped) {
                throw new Error("simulateKeyCombo: unknown modifier \""+m+"\" in \""+args.combo+"\". Supported: Ctrl, Cmd, Shift, Alt, Meta (format \"Mod+Key\").");
            }
            if (!electronMods.includes(mapped)) electronMods.push(mapped);
        }

        // "Ctrl+" collapses to a bare modifier as the final key and "Super+D"
        // silently drops its modifier — both echoed {success:true} (docs §2 mask-required).
        if (MODIFIER_TOKENS[key.toLowerCase()]) {
            throw new Error("simulateKeyCombo: \""+args.combo+"\" ends in a modifier — a final non-modifier key is required");
        }
        const wc = getWebContents();
        wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: electronMods });
        wc.sendInputEvent({ type: 'keyUp',   keyCode: key, modifiers: electronMods });
        return { success: true, combo: args.combo };
    }

    @utcpTool(
        'simulateMouseClick',
        'Simulate a mouse click at (x, y) in editor window coordinates via webContents.sendInputEvent (mouseDown + mouseUp). Coordinates are in the editor window client area.',
        {
            type: 'object',
            properties: {
                x: { type: 'number', description: 'X coordinate in editor window client area' },
                y: { type: 'number', description: 'Y coordinate in editor window client area' },
                button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'Mouse button (default left)' },
                clickCount: { type: 'number', description: 'Click count (default 1; 2 = double-click)' },
            },
            required: ['x', 'y'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
            },
            required: ['success'],
        },
        'POST',
        ['input', 'mouse', 'click', 'simulate', 'pointer']
    )
    async simulateMouseClick(args: { x: number, y: number, button?: string, clickCount?: number }): Promise<{ success: boolean }> {
        if (typeof args.x !== 'number' || typeof args.y !== 'number') throw new Error('simulateMouseClick requires x and y numbers');
        const wc = getWebContents();
        const button  = (args.button || 'left') as string;
        const clicks  = Math.max(1, Math.min(args.clickCount ?? 1, 3));
        // Pass 0 emits a combined mouse-move + mouseDown; future arg would pass a real button value.
        wc.sendInputEvent({ type: 'mouseDown', button, x: Math.round(args.x), y: Math.round(args.y), clickCount: clicks });
        wc.sendInputEvent({ type: 'mouseUp',   button, x: Math.round(args.x), y: Math.round(args.y), clickCount: clicks });
        return { success: true };
    }

    @utcpTool(
        'simulateMouseDrag',
        'Simulate a mouse drag from (x, y) to (x2, y2) via webContents.sendInputEvent (mouseDown, mouseMove steps, mouseUp).',
        {
            type: 'object',
            properties: {
                x:  { type: 'number', description: 'Start X' },
                y:  { type: 'number', description: 'Start Y' },
                x2: { type: 'number', description: 'End X' },
                y2: { type: 'number', description: 'End Y' },
                steps: { type: 'number', description: 'Interpolation steps (default 1)' },
                button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'Mouse button (default left)' },
            },
            required: ['x', 'y', 'x2', 'y2'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
            },
            required: ['success'],
        },
        'POST',
        ['input', 'mouse', 'drag', 'simulate', 'pointer']
    )
    async simulateMouseDrag(args: { x: number, y: number, x2: number, y2: number, steps?: number, button?: string }): Promise<{ success: boolean }> {
        for (const k of ['x','y','x2','y2'] as const) {
            if (typeof (args as any)[k] !== 'number') throw new Error(`simulateMouseDrag requires numeric ${k}`);
        }
        const wc = getWebContents();
        const button = (args.button || 'left') as string;
        const steps = Math.max(1, Math.min(args.steps ?? 1, 20));
        wc.sendInputEvent({ type: 'mouseDown', button, x: Math.round(args.x), y: Math.round(args.y), clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const mx = Math.round(args.x + (args.x2 - args.x) * t);
            const my = Math.round(args.y + (args.y2 - args.y) * t);
            wc.sendInputEvent({ type: 'mouseMove', x: mx, y: my });
        }
        wc.sendInputEvent({ type: 'mouseUp', button, x: Math.round(args.x2), y: Math.round(args.y2), clickCount: 1 });
        return { success: true };
    }
}
