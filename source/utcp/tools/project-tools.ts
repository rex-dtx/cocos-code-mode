import { utcpTool } from '../decorators';

export class ProjectTools {

    @utcpTool(
        'projectGetConfig',
        'Read project settings. With no arguments returns the whole settings object; with type returns one category (e.g. general, physics, sorting-layer, layer); with type+key returns one value inside the category.',
        {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Settings category, e.g. general, physics, sorting-layer, script, builder' },
                key: { type: 'string', description: 'Property name inside the category' }
            }
        },
        { type: 'object', properties: { config: {} }, required: ['config'] }, "GET", ['project', 'settings', 'config', 'get', 'read']
    )
    async projectGetConfig(args: { type?: string, key?: string }): Promise<{ config: any }> {
        // Store 'project' holds project settings (same usage as project-settings-importer.ts)
        const all = await Editor.Message.request('project', 'query-config', 'project');
        if (all === undefined || all === null) {
            throw new Error('Failed to read project settings');
        }
        if (!args.type) {
            return { config: all };
        }
        const category = (all as any)[args.type];
        if (category === undefined) {
            throw new Error(`Unknown project settings type "${args.type}". Available: ${Object.keys(all as any).join(', ')}`);
        }
        if (!args.key) {
            return { config: category };
        }
        const value = category[args.key];
        if (value === undefined) {
            const keys = (category && typeof category === 'object') ? Object.keys(category).join(', ') : '';
            throw new Error(`Unknown key "${args.key}" in project settings type "${args.type}". Available: ${keys}`);
        }
        return { config: value };
    }

    @utcpTool(
        'projectSetConfig',
        'Write project settings. Path is either a category name (e.g. "general" with the full category object as value) or a dotted path (e.g. "physics.collisionMatrix"). CAUTION: affects the whole project - read current values with projectGetConfig first.',
        {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Category name or dotted path, e.g. "general", "physics", "layer.3", "general.designResolution"' },
                value: { description: 'New value (JSON-serializable): full category object for a category path, leaf value for a dotted path' }
            },
            required: ['path', 'value']
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] }, "POST", ['project', 'settings', 'config', 'set', 'write']
    )
    async projectSetConfig(args: { path: string, value: any }): Promise<{ success: boolean }> {
        if (!args.path) {
            throw new Error('projectSetConfig requires path');
        }
        const ok = await Editor.Message.request('project', 'set-config', 'project', args.path, args.value);
        if (ok === false) {
            throw new Error(`Failed to set project config at "${args.path}"`);
        }
        return { success: true };
    }
}
