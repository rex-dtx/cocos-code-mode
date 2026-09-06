import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { getConfigManager } from '../config-manager';

const KNOWN_KEYS: Record<string, string> = {
    serverPort: 'number — UTCP HTTP server port (0 = auto)',
    utcpConfigPath: 'string — path to ~/.utcp_config.json',
};

export class PreferenceTools {

    @utcpTool(
        'getEditorPreference',
        'Read one or all cc-bridge-2x persistent preferences (Editor.Profile). Omit key to list all known keys.',
        {
            type: 'object',
            properties: {
                key: { type: 'string', description: `Preference key. Known: ${Object.keys(KNOWN_KEYS).join(', ')}. Omit to list all.` },
            },
        },
        {
            type: 'object',
            properties: {
                key: { type: 'string' },
                value: {},
                all: { type: 'object' },
            },
        },
        'GET',
        ['preference', 'config', 'setting', 'read', 'editor']
    )
    async getEditorPreference(args: { key?: string } = {}): Promise<{ key?: string, value?: any, all?: Record<string, any> }> {
        const mgr = getConfigManager();
        if (args.key) {
            return { key: args.key, value: mgr.getPreference(args.key, null) };
        }
        const all: Record<string, any> = {};
        for (const key of Object.keys(KNOWN_KEYS)) {
            all[key] = mgr.getPreference(key, null);
        }
        return { all };
    }

    @utcpTool(
        'setEditorPreference',
        'Write a cc-bridge-2x persistent preference (Editor.Profile). Known keys are type-validated.',
        {
            type: 'object',
            properties: {
                key: { type: 'string', description: `Preference key. Known: ${Object.keys(KNOWN_KEYS).join(', ')}` },
                value: { description: 'New value. Must match the key type.' },
            },
            required: ['key', 'value'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                key: { type: 'string' },
                value: {},
            },
            required: ['success', 'key'],
        },
        'POST',
        ['preference', 'config', 'setting', 'write', 'editor']
    )
    async setEditorPreference(args: { key: string, value: any }): Promise<{ success: boolean, key: string, value: any }> {
        if (!args.key) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'setEditorPreference requires key',
                recovery: `Known keys: ${Object.keys(KNOWN_KEYS).join(', ')}.`,
            });
        }
        if (args.key in KNOWN_KEYS) {
            const expected = KNOWN_KEYS[args.key].split(' ')[0];
            if (expected === 'number' && typeof args.value !== 'number') {
                throw new ToolError({ code: 'INVALID_INPUT', status: 400, message: `Key '${args.key}' expects a number`, recovery: 'Pass a numeric value.' });
            }
            if (expected === 'string' && typeof args.value !== 'string') {
                throw new ToolError({ code: 'INVALID_INPUT', status: 400, message: `Key '${args.key}' expects a string`, recovery: 'Pass a string value.' });
            }
        }
        const ok = getConfigManager().setPreference(args.key, args.value);
        if (!ok) {
            throw new ToolError({
                code: 'PROFILE_UNAVAILABLE',
                status: 500,
                message: 'Editor.Profile is not available; preference was not persisted.',
                recovery: 'Open a project so profile://project/cc-bridge-2x.json can load.',
            });
        }
        return { success: true, key: args.key, value: args.value };
    }
}
