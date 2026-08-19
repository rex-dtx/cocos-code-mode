import { ISuccessIndicator } from '../schemas';

export class PreviewTools {

    // via previewManage — kept for delegation, no @utcpTool
    async previewGetUrl(): Promise<{ url: string }> {
        const url = await Editor.Message.request('preview', 'query-preview-url');
        if (!url || typeof url !== 'string') throw new Error('Preview URL not available - is the preview server running?');
        return { url };
    }

    // via previewManage — kept for delegation, no @utcpTool
    async previewOpenInBrowser(): Promise<ISuccessIndicator> {
        await Editor.Message.request('preview', 'preview-scene-in-browser');
        return { success: true };
    }
}
