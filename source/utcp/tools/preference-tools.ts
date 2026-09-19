import { utcpTool } from '../decorators';
import { getConfigManager } from '../config-manager';
// @ts-ignore
import packageJSON from '../../../package.json';

// Editor preference tools — read/write persistent config via Editor.Profile.
// The bridge's own profile remains the default, while callers may target a
// bounded package identifier for third-party editor preferences.
const DEFAULT_PACKAGE = packageJSON.name;
const PACKAGE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const KEY_PATTERN = /^[A-Za-z0-9._/-]{1,256}$/;

const KNOWN_KEYS: Record<string, string> = {
    fixedServerPort: 'number — configured UTCP HTTP port (0 or unset = reusable auto port with occupied-port fallback)',
    toolProfile: 'string — "core" | "full" | "custom"',
    enabledTools: 'string[] — extra tools exposed when profile=core/custom',
    disabledTools: 'string[] — tools hidden even in profile=full',
    responseEnvelope: 'boolean — wrap responses in {ok,callId,data,refs} envelope',
    utcpConfigPath: 'string — path to ~/.utcp_config.json',
};

function preferenceTarget(args: { packageName?: string, pkg?: string, key?: string }): { packageName: string, key: string } {
    const packageName = args.packageName ?? args.pkg ?? DEFAULT_PACKAGE;
    const key = args.key;
    if (typeof packageName !== 'string' || !PACKAGE_PATTERN.test(packageName)) throw new Error('packageName must be a bounded preference package identifier.');
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw new Error('key must be a bounded preference identifier.');
    return { packageName, key };
}

export class PreferenceTools {

    @utcpTool(
        'getEditorPreference',
        'Read a bounded Editor.Profile preference. Omit key to list known bridge keys; packageName/pkg targets an arbitrary package.',
        {
            type: 'object',
            properties: {
                packageName: { type: 'string', minLength: 1, maxLength: 128 },
                pkg: { type: 'string', minLength: 1, maxLength: 128 },
                key: { type: 'string', minLength: 1, maxLength: 256, description: `Preference key. Known bridge keys: ${Object.keys(KNOWN_KEYS).join(', ')}. Omit only for the default package.` },
            },
        },
        {
            type: 'object',
            properties: {
                packageName: { type: 'string' },
                key: { type: 'string' },
                value: {},
                all: { type: 'object', description: 'Present when key omitted for the default package: every known preference' },
            },
            required: [],
        },
        'GET',
        ['preference', 'config', 'setting', 'read', 'editor']
    )
    async getEditorPreference(args: { packageName?: string, pkg?: string, key?: string }): Promise<{ packageName?: string, key?: string, value?: unknown, all?: Record<string, unknown> }> {
        const packageName = args.packageName ?? args.pkg ?? DEFAULT_PACKAGE;
        if (args.key !== undefined) {
            const target = preferenceTarget({ packageName, key: args.key });
            const value = await Editor.Profile.getConfig(target.packageName, target.key);
            return { ...(packageName !== DEFAULT_PACKAGE ? { packageName } : {}), key: target.key, value: value === undefined ? null : value };
        }
        if (packageName !== DEFAULT_PACKAGE) throw new Error('key is required for a non-default preference package.');
        const all: Record<string, unknown> = {};
        for (const key of Object.keys(KNOWN_KEYS)) {
            const value = await Editor.Profile.getConfig(DEFAULT_PACKAGE, key);
            all[key] = value === undefined ? null : value;
        }
        return { all };
    }

    @utcpTool(
        'setEditorPreference',
        'Write a bounded Editor.Profile preference and return authoritative read-back. Known bridge keys are type-validated; packageName/pkg targets arbitrary packages.',
        {
            type: 'object',
            properties: {
                packageName: { type: 'string', minLength: 1, maxLength: 128 },
                pkg: { type: 'string', minLength: 1, maxLength: 128 },
                key: { type: 'string', minLength: 1, maxLength: 256 },
                value: { description: 'New value. Must match known bridge key types.' },
            },
            required: ['key', 'value'],
        },
        {
            type: 'object',
            properties: { success: { type: 'boolean' }, packageName: { type: 'string' }, key: { type: 'string' }, value: {} },
            required: ['success', 'key', 'value'],
        },
        'POST',
        ['preference', 'config', 'setting', 'write', 'editor']
    )
    async setEditorPreference(args: { packageName?: string, pkg?: string, key: string, value: unknown }): Promise<{ success: boolean, packageName?: string, key: string, value: unknown }> {
        const target = preferenceTarget(args);
        if (target.packageName === DEFAULT_PACKAGE && target.key in KNOWN_KEYS) {
            const expected = KNOWN_KEYS[target.key].split(' ')[0];
            if (expected === 'number' && typeof args.value !== 'number') throw new Error(`Key '${target.key}' expects a number`);
            if (expected === 'string' && typeof args.value !== 'string') throw new Error(`Key '${target.key}' expects a string`);
            if (expected === 'boolean' && typeof args.value !== 'boolean') throw new Error(`Key '${target.key}' expects a boolean`);
            if (expected === 'string[]' && (!Array.isArray(args.value) || args.value.some((item: unknown) => typeof item !== 'string'))) throw new Error(`Key '${target.key}' expects a string array`);
        }
        if (target.packageName === DEFAULT_PACKAGE && target.key === 'fixedServerPort') {
            if (typeof args.value !== 'number') throw new Error(`Key '${target.key}' expects a number`);
            await getConfigManager().setConfiguredPort(args.value);
        }
        else await Editor.Profile.setConfig(target.packageName, target.key, args.value as any);
        const readBack = target.packageName === DEFAULT_PACKAGE && target.key === 'fixedServerPort'
            ? await getConfigManager().getCurrentPort()
            : await Editor.Profile.getConfig(target.packageName, target.key);
        const value: unknown = readBack === undefined ? null : readBack;
        return { success: JSON.stringify(value) === JSON.stringify(args.value), ...(target.packageName !== DEFAULT_PACKAGE ? { packageName: target.packageName } : {}), key: target.key, value };
    }


    @utcpTool(
        'queryPreferencesConfig',
        'Read a bounded package/key preference config through Creator preferences IPC.',
        {
            type: 'object',
            properties: { packageName: { type: 'string', minLength: 1, maxLength: 128 }, key: { type: 'string', minLength: 1, maxLength: 256 } },
            required: ['packageName', 'key'],
        },
        { type: 'object', properties: { value: {} }, required: ['value'] },
        'GET', ['preference', 'preferences', 'config', 'package', 'read']
    )
    async queryPreferencesConfig(args: { packageName: string, key: string }): Promise<{ value: unknown }> {
        const target = preferenceTarget(args);
        const value = await Editor.Message.request('preferences', 'queryConfig', target.packageName, target.key);
        return { value: value === undefined ? null : value };
    }

    @utcpTool(
        'setPreferencesConfig',
        'Write a bounded package/key preference config and return the authoritative preference read-back.',
        {
            type: 'object',
            properties: { packageName: { type: 'string', minLength: 1, maxLength: 128 }, key: { type: 'string', minLength: 1, maxLength: 256 }, value: {} },
            required: ['packageName', 'key', 'value'],
        },
        { type: 'object', properties: { updated: { type: 'boolean' }, value: {} }, required: ['updated', 'value'] },
        'POST', ['preference', 'preferences', 'config', 'package', 'write']
    )
    async setPreferencesConfig(args: { packageName: string, key: string, value: unknown }): Promise<{ updated: boolean, value: unknown }> {
        const target = preferenceTarget(args);
        await Editor.Message.request('preferences', 'setConfig', target.packageName, target.key, args.value);
        const readBack = await Editor.Message.request('preferences', 'queryConfig', target.packageName, target.key);
        return { updated: JSON.stringify(readBack) === JSON.stringify(args.value), value: readBack === undefined ? null : readBack };
    }
}
