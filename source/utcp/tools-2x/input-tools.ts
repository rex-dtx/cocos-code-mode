import { ToolError } from '../tool-error';
import { utcpTool } from '../decorators';

function getWebContents(): any {
    let BrowserWindow: any;
    try {
        const electron = require('electron');
        BrowserWindow = electron.BrowserWindow;
    } catch (e: any) {
        try {
            const electron = Editor.require('electron');
            BrowserWindow = electron && electron.BrowserWindow;
        } catch (e2: any) {
            throw new ToolError({
                code: 'UNSUPPORTED_EDITOR_API',
                status: 422,
                message: `Electron not available: ${e2 && e2.message || e && e.message}`,
                recovery: 'Input simulation needs Electron BrowserWindow in the editor main process.',
            });
        }
    }
    if (!BrowserWindow) {
        throw new ToolError({
            code: 'UNSUPPORTED_EDITOR_API',
            status: 422,
            message: 'Electron BrowserWindow not available',
            recovery: 'Creator 2.4 must expose electron.BrowserWindow in the extension host.',
        });
    }
    const wins: any[] = BrowserWindow.getAllWindows();
    const target = BrowserWindow.getFocusedWindow() || wins[0];
    if (!target) {
        throw new ToolError({
            code: 'NO_EDITOR_WINDOW',
            status: 422,
            message: 'No Electron window found',
            recovery: 'Focus the Creator 2.4 window and retry.',
        });
    }
    const wc = target.webContents;
    if (!wc || typeof wc.sendInputEvent !== 'function') {
        throw new ToolError({
            code: 'UNSUPPORTED_EDITOR_API',
            status: 422,
            message: 'webContents.sendInputEvent not available',
            recovery: 'This Electron shell does not expose sendInputEvent.',
        });
    }
    return wc;
}

function modifiersOf(args: { shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean }): string[] {
    const mods: string[] = [];
    if (args.shift) mods.push('shift');
    if (args.ctrl || args.meta) mods.push('control');
    if (args.alt) mods.push('alt');
    return mods;
}

const MODIFIER_TOKENS: Record<string, string> = {
    ctrl: 'control', control: 'control', cmd: 'control', command: 'control', meta: 'control',
    shift: 'shift', alt: 'alt', option: 'alt',
};

export function parseKeyCombo(combo: string): { key: string, modifiers: string[] } {
    const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) {
        throw new ToolError({
            code: 'INVALID_INPUT',
            status: 400,
            message: 'simulateKeyCombo: empty combo',
            recovery: 'Use "Mod+Key", e.g. Ctrl+S.',
        });
    }
    const mods = parts.slice(0, -1);
    const key = parts[parts.length - 1];
    const electronMods: string[] = [];
    for (const m of mods) {
        const mapped = MODIFIER_TOKENS[m.toLowerCase()];
        if (!mapped) {
            throw new ToolError({
                code: 'INVALID_INPUT',
                status: 400,
                message: `simulateKeyCombo: unknown modifier "${m}" in "${combo}"`,
                details: { modifier: m, combo },
                recovery: 'Supported modifiers: Ctrl, Cmd, Shift, Alt, Meta.',
            });
        }
        if (!electronMods.includes(mapped)) electronMods.push(mapped);
    }
    if (MODIFIER_TOKENS[key.toLowerCase()]) {
        throw new ToolError({
            code: 'INVALID_INPUT',
            status: 400,
            message: `simulateKeyCombo: "${combo}" ends in a modifier — a final non-modifier key is required`,
            details: { combo },
            recovery: 'Use "Mod+Key" with a real key last, e.g. Ctrl+S',
        });
    }
    return { key, modifiers: electronMods };
}

export class InputTools {

    @utcpTool(
        'simulateKeyPress',
        'Simulate a single key press (keyDown + keyUp) via Electron webContents.sendInputEvent. Fails fast if the API is unavailable.',
        {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key code, e.g. "A", "Enter", "Escape", "F5"' },
                modifiers: {
                    type: 'object',
                    properties: {
                        shift: { type: 'boolean' },
                        ctrl: { type: 'boolean' },
                        alt: { type: 'boolean' },
                        meta: { type: 'boolean' },
                    },
                },
            },
            required: ['key'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, key: { type: 'string' } }, required: ['success'] },
        'POST',
        ['input', 'keyboard', 'key', 'simulate', 'press', 'shortcut']
    )
    async simulateKeyPress(args: { key: string, modifiers?: { shift?: boolean, ctrl?: boolean, alt?: boolean, meta?: boolean } }): Promise<{ success: boolean, key: string }> {
        if (!args.key || !String(args.key).trim()) {
            throw new ToolError({ code: 'MISSING_INPUTS', status: 400, message: 'simulateKeyPress requires key', recovery: 'Pass key, e.g. Enter.' });
        }
        const wc = getWebContents();
        const mods = args.modifiers ? modifiersOf(args.modifiers) : [];
        wc.sendInputEvent({ type: 'keyDown', keyCode: args.key, modifiers: mods });
        wc.sendInputEvent({ type: 'keyUp', keyCode: args.key, modifiers: mods });
        return { success: true, key: args.key };
    }

    @utcpTool(
        'simulateKeyCombo',
        'Simulate a key combo (e.g. "Ctrl+D") via webContents.sendInputEvent.',
        {
            type: 'object',
            properties: {
                combo: { type: 'string', description: 'Combo string like "Ctrl+Shift+D"' },
            },
            required: ['combo'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, combo: { type: 'string' } }, required: ['success'] },
        'POST',
        ['input', 'keyboard', 'combo', 'shortcut', 'hotkey', 'simulate']
    )
    async simulateKeyCombo(args: { combo: string }): Promise<{ success: boolean, combo: string }> {
        if (!args.combo || !String(args.combo).trim()) {
            throw new ToolError({ code: 'MISSING_INPUTS', status: 400, message: 'simulateKeyCombo requires combo string', recovery: 'Pass combo like Ctrl+S.' });
        }
        const parsed = parseKeyCombo(args.combo);
        const wc = getWebContents();
        wc.sendInputEvent({ type: 'keyDown', keyCode: parsed.key, modifiers: parsed.modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode: parsed.key, modifiers: parsed.modifiers });
        return { success: true, combo: args.combo };
    }

    @utcpTool(
        'simulateMouseClick',
        'Simulate a mouse click at (x, y) in editor window coordinates.',
        {
            type: 'object',
            properties: {
                x: { type: 'number', description: 'X in editor window client area' },
                y: { type: 'number', description: 'Y in editor window client area' },
                button: { type: 'string', enum: ['left', 'middle', 'right'] },
                clickCount: { type: 'number', description: '1 = single, 2 = double' },
            },
            required: ['x', 'y'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST',
        ['input', 'mouse', 'click', 'simulate', 'pointer']
    )
    async simulateMouseClick(args: { x: number, y: number, button?: string, clickCount?: number }): Promise<{ success: boolean }> {
        const x = Number(args.x);
        const y = Number(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new ToolError({ code: 'INVALID_INPUT', status: 400, message: 'simulateMouseClick requires x and y numbers', recovery: 'Pass numeric client coordinates.' });
        }
        const wc = getWebContents();
        const button = (args.button || 'left') as string;
        const clicks = Math.max(1, Math.min(Number(args.clickCount) || 1, 3));
        wc.sendInputEvent({ type: 'mouseDown', button, x: Math.round(x), y: Math.round(y), clickCount: clicks });
        wc.sendInputEvent({ type: 'mouseUp', button, x: Math.round(x), y: Math.round(y), clickCount: clicks });
        return { success: true };
    }

    @utcpTool(
        'simulateMouseDrag',
        'Simulate a mouse drag from (x, y) to (x2, y2).',
        {
            type: 'object',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                x2: { type: 'number' },
                y2: { type: 'number' },
                steps: { type: 'number', description: 'Interpolation steps (default 1)' },
                button: { type: 'string', enum: ['left', 'middle', 'right'] },
            },
            required: ['x', 'y', 'x2', 'y2'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST',
        ['input', 'mouse', 'drag', 'simulate', 'pointer']
    )
    async simulateMouseDrag(args: { x: number, y: number, x2: number, y2: number, steps?: number, button?: string }): Promise<{ success: boolean }> {
        const nums = ['x', 'y', 'x2', 'y2'] as const;
        for (const k of nums) {
            if (!Number.isFinite(Number((args as any)[k]))) {
                throw new ToolError({ code: 'INVALID_INPUT', status: 400, message: `simulateMouseDrag requires numeric ${k}`, recovery: 'Pass numeric client coordinates.' });
            }
        }
        const wc = getWebContents();
        const button = (args.button || 'left') as string;
        const steps = Math.max(1, Math.min(Number(args.steps) || 1, 20));
        wc.sendInputEvent({ type: 'mouseDown', button, x: Math.round(args.x), y: Math.round(args.y), clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            wc.sendInputEvent({
                type: 'mouseMove',
                x: Math.round(args.x + (args.x2 - args.x) * t),
                y: Math.round(args.y + (args.y2 - args.y) * t),
            });
        }
        wc.sendInputEvent({ type: 'mouseUp', button, x: Math.round(args.x2), y: Math.round(args.y2), clickCount: 1 });
        return { success: true };
    }
}
