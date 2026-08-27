import { utcpTool } from '../decorators';

// Screenshot tools — capture scene canvas and editor windows.
// Scene capture reuses the existing captureScreenshot in scene.ts.
// Editor capture uses Electron BrowserWindow API (may not be available in all contexts).

export class ScreenshotTools {

    @utcpTool(
        'captureSceneScreenshot',
        'Capture the current scene view as a JPEG image. Uses the game canvas in edit mode.',
        {
            type: 'object',
            properties: {
                imageSize: {
                    oneOf: [
                        { type: 'number', description: 'Square size (width=height)' },
                        { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] },
                    ],
                    description: 'Image size (default 512)',
                },
                jpegQuality: { type: 'number', description: 'JPEG quality 0-100 (default 80)' },
            },
        },
        {
            type: 'object',
            properties: {
                type: { type: 'string' },
                data: { type: 'string', description: 'Base64-encoded JPEG data' },
                mimeType: { type: 'string' },
            },
            required: ['type', 'data', 'mimeType'],
        },
        'POST',
        ['screenshot', 'capture', 'scene', 'image', 'visual', 'verify']
    )
    async captureSceneScreenshot(args: { imageSize?: number | { width: number, height: number }, jpegQuality?: number }): Promise<{ type: string, data: string, mimeType: string }> {
        const imageSize = typeof args.imageSize === 'number'
            ? { width: args.imageSize, height: args.imageSize }
            : args.imageSize || { width: 512, height: 512 };
        const jpegQuality = args.jpegQuality ?? 80;

        const base64 = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'cc-bridge-3x',
            method: 'captureScreenshot',
            args: [imageSize, jpegQuality],
        }) as string;

        if (!base64 || typeof base64 !== 'string') {
            throw new Error('Failed to capture scene screenshot');
        }

        return { type: 'image', data: base64, mimeType: 'image/jpeg' };
    }

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
        let BrowserWindow: any;
        try {
            const electron = require('electron');
            BrowserWindow = electron.BrowserWindow;
        } catch (e: any) {
            throw new Error(`Electron BrowserWindow not available: ${e.message}`);
        }

        if (!BrowserWindow) {
            throw new Error('BrowserWindow API not available in this context');
        }

        let targetWindow: any = null;
        if (args.windowTitle) {
            const allWindows = BrowserWindow.getAllWindows();
            targetWindow = allWindows.find((w: any) => w.getTitle().includes(args.windowTitle));
        }
        if (!targetWindow) {
            targetWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        }

        if (!targetWindow) {
            throw new Error('No editor window found');
        }

        try {
            const image = await targetWindow.capturePage();
            const buffer = image.toPNG();
            const base64 = buffer.toString('base64');
            return { type: 'image', data: base64, mimeType: 'image/png' };
        } catch (e: any) {
            throw new Error(`Failed to capture editor window: ${e.message}`);
        }
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
        let BrowserWindow: any;
        try {
            const electron = require('electron');
            BrowserWindow = electron.BrowserWindow;
        } catch (e: any) {
            throw new Error(`Electron BrowserWindow not available: ${e.message}`);
        }

        if (!BrowserWindow) {
            throw new Error('BrowserWindow API not available in this context');
        }

        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = BrowserWindow.getFocusedWindow();

        return {
            windows: allWindows.map((w: any) => ({
                id: w.id,
                title: w.getTitle(),
                focused: w === focusedWindow,
            })),
        };
    }
}
