import { utcpTool } from '../decorators';

/**
 * Lightweight preview helpers — no engine scene mutation.
 * Uses editor IPC (scene/preview panels), not scene-script.
 */
export class EditorExtraTools {

    @utcpTool(
        'editorOperate',
        'Common editor actions: save scene, refresh asset-db.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['save_scene', 'refresh_assets'], description: 'Which action' },
            },
            required: ['operation'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['editor', 'operate', 'save', 'refresh']
    )
    async editorOperate(args: { operation: string }): Promise<any> {
        switch (args.operation) {
            case 'save_scene': {
                // 2.4: fire-and-forget — ref pkg does sendToPanel('scene','scene:stash-and-save') with NO callback.
                // Awaiting reply causes 10s timeout; just send and return.
                try {
                    Editor.Ipc.sendToPanel('scene', 'scene:stash-and-save');
                    return { success: true };
                } catch (e: any) {
                    throw new Error(`save_scene failed: ${e?.message || e}`);
                }
            }
            case 'refresh_assets':
                await new Promise<void>((resolve) => {
                    try { Editor.assetdb.refresh('db://assets', (() => resolve()) as any); }
                    catch (e) { resolve(); }
                });
                return { success: true };
            default:
                throw new Error('Unknown operation: ' + args.operation);
        }
    }

    @utcpTool(
        'projectSaveConfig',
        'Write a project settings key. Mirrors projectGetConfig but for writes. Use sparingly — settings carry editor state.',
        {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Settings file name without extension, e.g. project' },
                key: { type: 'string', description: 'Key to set' },
                value: { description: 'Value to write' },
            },
            required: ['type', 'key', 'value'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['project', 'config', 'settings', 'write', 'save']
    )
    async projectSaveConfig(args: { type: string, key: string, value: any }): Promise<any> {
        const projectPath = Editor.Project.path;
        if (!projectPath) throw new Error('Editor.Project.path is not available');
        const file = require('path').join(projectPath, 'settings', `${args.type}.json`);
        const fs = require('fs');
        if (!fs.existsSync(file)) throw new Error('Settings file not found: ' + file);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data[args.key] = args.value;
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return { success: true };
    }
}
