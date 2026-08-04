import { utcpTool } from '../decorators';
import { SuccessIndicatorSchema, ISuccessIndicator } from '../schemas';

export class PreviewTools {

    @utcpTool(
        'previewGetUrl',
        'Get the URL of the editor game preview server (browser preview of the current scene/game).',
        { type: 'object', properties: {} },
        { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, "GET", ['preview', 'url', 'browser', 'server', 'play']
    )
    async previewGetUrl(): Promise<{ url: string }> {
        const url = await Editor.Message.request('preview', 'query-preview-url');
        if (!url || typeof url !== 'string') {
            throw new Error('Preview URL not available - is the preview server running?');
        }
        return { url };
    }

    @utcpTool(
        'previewOpenInBrowser',
        'Open the current scene/game preview in the system default browser (the browser preview used for smoke testing).',
        { type: 'object', properties: {} },
        SuccessIndicatorSchema, "POST", ['preview', 'browser', 'open', 'play', 'test', 'smoke']
    )
    async previewOpenInBrowser(): Promise<ISuccessIndicator> {
        await Editor.Message.request('preview', 'preview-scene-in-browser');
        return { success: true };
    }
}
