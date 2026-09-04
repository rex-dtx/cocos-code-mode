import { ToolError } from '../tool-error';
import { isMessageNotExposed } from '../utils/editor-message-error';

/**
 * Canonical IPC signature for the 3.8 project config write.
 * Verified shape: Editor.Message.request('project','set-config','project', dotPath, value)
 * Return: true on success, false/throw on failure; "Message does not exist: project - set-config" when not exposed (3.7).
 */
export const PROJECT_SET_CONFIG_SIGNATURE = "Editor.Message.request('project','set-config','project', dotPath, value)" as const;

/**
 * Capability probe for `project/set-config`.
 * Does NOT mutate real project settings: it attempts a probe write to a disposable path
 * `__probe__.capability`. If the message exists the call either succeeds or throws a domain
 * error ("Config path ..."), both meaning "supported". Only the registry verbatim
 * "Message does not exist: project - set-config" means unsupported (3.7).
 *
 * Live verification requires a real Creator 3.8 editor — see pending-live comment in tests.
 */
export async function probeProjectSetConfigCapability(): Promise<{ supported: boolean; signature: typeof PROJECT_SET_CONFIG_SIGNATURE; error?: string }> {
    const probePath = '__probe__.capability';
    const probeValue = '__probe__';
    try {
        await Editor.Message.request('project', 'set-config', 'project', probePath, probeValue);
        return { supported: true, signature: PROJECT_SET_CONFIG_SIGNATURE };
    } catch (e: unknown) {
        if (isMessageNotExposed(e, 'project', 'set-config')) {
            const msg = e instanceof Error ? e.message : String(e ?? '');
            return { supported: false, signature: PROJECT_SET_CONFIG_SIGNATURE, error: msg };
        }
        // Any other error means the message IS exposed (domain validation / config-path error, etc.)
        return { supported: true, signature: PROJECT_SET_CONFIG_SIGNATURE };
    }
}

export class ProjectTools {

    // via projectManage — kept for delegation
    async projectGetConfig(args: { type?: string, key?: string, limit?: number }): Promise<{ config: unknown, total?: number, truncated?: boolean }> {
        const all = await Editor.Message.request('project', 'query-config', 'project') as unknown as Record<string, unknown> | null | undefined;
        if (all === undefined || all === null) throw new Error('Failed to read project settings');
        if (!args.type) {
            const entries = Object.entries(all);
            const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
            return { config: Object.fromEntries(entries.slice(0, limit)), total: entries.length, truncated: entries.length > limit };
        }
        const category = all[args.type];
        if (category === undefined) throw new Error(`Unknown project settings type "${args.type}". Available: ${Object.keys(all).join(', ')}`);
        if (!args.key) return { config: category };
        if (category === null || typeof category !== 'object') throw new Error(`Unknown key "${args.key}" in project settings type "${args.type}".`);
        const record = category as unknown as Record<string, unknown>;
        const value = record[args.key];
        if (value === undefined) {
            const keys = Object.keys(record).join(', ');
            throw new Error(`Unknown key "${args.key}" in project settings type "${args.type}". Available: ${keys}`);
        }
        return { config: value };
    }

    // via projectManage — kept for delegation. Gated by capability probe (see probeProjectSetConfigCapability).
    // On 3.8: routes through IPC with (project, dotPath, value) and returns { success: true }.
    // On 3.7: IPC is not exposed -> typed UNSUPPORTED_EDITOR_API 422 with recovery; NO filesystem fallback.
    async projectSetConfig(args: { path: string, value: unknown }): Promise<{ success: boolean }> {
        if (!args.path) throw new Error('projectSetConfig requires path');
        try {
            const ok = await Editor.Message.request('project', 'set-config', 'project', args.path, args.value);
            if (ok === false) throw new Error(`Failed to set project config at "${args.path}"`);
        } catch (e: unknown) {
            if (isMessageNotExposed(e, 'project', 'set-config')) {
                throw new ToolError({
                    code: 'UNSUPPORTED_EDITOR_API',
                    message: "projectManage set is unavailable: Cocos Creator 3.7 does not expose 'project/set-config'.",
                    details: {
                        api: 'project/set-config',
                        requiredEditorVersion: '3.8.x',
                        requestedPath: args.path,
                    },
                    recovery: 'Edit settings/v2/packages/*.json directly to change project settings.',
                });
            }
            throw e;
        }
        return { success: true };
    }
}
