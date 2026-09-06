import { ToolError } from '../tool-error';
import { utcpTool } from '../decorators';

function loadBrowserWindow(): any {
    let BrowserWindow: any;
    try {
        BrowserWindow = require('electron').BrowserWindow;
    } catch (e: any) {
        try {
            const electron = Editor.require('electron');
            BrowserWindow = electron && electron.BrowserWindow;
        } catch (e2: any) {
            throw new ToolError({
                code: 'UNSUPPORTED_EDITOR_API',
                status: 422,
                message: `Electron not available: ${(e2 && e2.message) || (e && e.message)}`,
                recovery: 'Editor screenshots need Electron BrowserWindow in the extension host.',
            });
        }
    }
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') {
        throw new ToolError({
            code: 'UNSUPPORTED_EDITOR_API',
            status: 422,
            message: 'Electron BrowserWindow not available',
            recovery: 'Creator 2.4 must expose electron.BrowserWindow in the extension host.',
        });
    }
    return BrowserWindow;
}

export function pickEditorWindow(BrowserWindow: any, windowTitle?: string): any {
    const allWindows: any[] = BrowserWindow.getAllWindows() || [];
    if (windowTitle) {
        const match = allWindows.find((w: any) => String(w.getTitle()).includes(windowTitle));
        if (match) return match;
    }
    const target = BrowserWindow.getFocusedWindow() || allWindows[0];
    if (!target) {
        throw new ToolError({
            code: 'NO_EDITOR_WINDOW',
            status: 422,
            message: 'No Electron window found',
            recovery: 'Focus the Creator 2.4 window and retry.',
        });
    }
    return target;
}

export class ScreenshotTools {

    @utcpTool(
        'captureEditorScreenshot',
        'Capture the focused editor window as a PNG image. Requires Electron BrowserWindow API.',
        {
            type: 'object',
            properties: {
                windowTitle: { type: 'string', description: 'Optional window title substring to match' },
            },
        },
        {
            type: 'object',
            properties: {
                type: { type: 'string' },
                data: { type: 'string', description: 'Base64-encoded PNG data' },
                mimeType: { type: 'string' },
            },
            required: ['type', 'data', 'mimeType'],
        },
        'POST',
        ['screenshot', 'capture', 'editor', 'window', 'image', 'visual']
    )
    async captureEditorScreenshot(args: { windowTitle?: string }): Promise<{ type: string, data: string, mimeType: string }> {
        const BrowserWindow = loadBrowserWindow();
        const targetWindow = pickEditorWindow(BrowserWindow, args.windowTitle);
        if (typeof targetWindow.capturePage !== 'function') {
            throw new ToolError({
                code: 'UNSUPPORTED_EDITOR_API',
                status: 422,
                message: 'BrowserWindow.capturePage is not available',
                recovery: 'This Electron shell cannot capture editor windows.',
            });
        }
        const image = await targetWindow.capturePage();
        if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
            throw new ToolError({
                code: 'CAPTURE_EMPTY',
                status: 422,
                message: 'Editor window capture produced an empty image',
                recovery: 'Focus a visible Creator window and retry.',
            });
        }
        const buffer = image.toPNG();
        if (!buffer || !buffer.length) {
            throw new ToolError({
                code: 'CAPTURE_EMPTY',
                status: 422,
                message: 'Editor window capture produced no PNG bytes',
                recovery: 'Focus a visible Creator window and retry.',
            });
        }
        const base64 = buffer.toString('base64');
        if (!base64.startsWith('iVBORw0KGgo')) {
            throw new ToolError({
                code: 'CAPTURE_INVALID',
                status: 422,
                message: `Editor window capture produced invalid PNG (got ${JSON.stringify(base64.slice(0, 16))})`,
                recovery: 'Retry captureEditorScreenshot; if it persists the Electron image pipeline is broken.',
            });
        }
        return { type: 'image', data: base64, mimeType: 'image/png' };
    }

    @utcpTool(
        'listEditorWindows',
        'List available Electron windows for screenshot or input targeting.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                windows: { type: 'array', items: { type: 'object' } },
            },
            required: ['windows'],
        },
        'GET',
        ['window', 'list', 'editor', 'electron', 'screenshot', 'target']
    )
    async listEditorWindows(): Promise<{ windows: Array<{ id: number, title: string, focused: boolean }> }> {
        const BrowserWindow = loadBrowserWindow();
        const allWindows: any[] = BrowserWindow.getAllWindows() || [];
        const focusedWindow = BrowserWindow.getFocusedWindow && BrowserWindow.getFocusedWindow();
        return {
            windows: allWindows.map((w: any) => ({
                id: w.id,
                title: typeof w.getTitle === 'function' ? w.getTitle() : '',
                focused: w === focusedWindow,
            })),
        };
    }
}
