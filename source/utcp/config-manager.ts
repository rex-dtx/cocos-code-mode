import { readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';
import { homedir } from 'os';

// @ts-ignore
import packageJSON from '../../package.json';


export class UtcpConfigManager {
    private static instance: UtcpConfigManager;
    private static readonly CANON = 'ccb3x';
    private static readonly LEGACY = new Set(['cc-bridge-3x', 'cc3x7', 'ccb-3x', 'ccb_3x']);
    private configPath: string = '';

    private constructor() {}

    static getInstance(): UtcpConfigManager {
        if (!UtcpConfigManager.instance) {
            UtcpConfigManager.instance = new UtcpConfigManager();
        }
        return UtcpConfigManager.instance;
    }

    async initialize(): Promise<void> {
        const savedPath = await Editor.Profile.getConfig(packageJSON.name, 'utcpConfigPath');
        if (savedPath && typeof savedPath === 'string') {
            this.configPath = savedPath;
        } else {
            this.configPath = join(homedir(), '.utcp_config.json');
        }
        console.log(`[UtcpConfigManager] Initialized with config path: ${this.configPath}`);
    }

    getConfigPath(): string {
        if (!this.configPath) {
            this.configPath = join(homedir(), '.utcp_config.json');
        }
        return this.configPath;
    }

    async setConfigPath(path: string): Promise<void> {
        this.configPath = path;
        await Editor.Profile.setConfig(packageJSON.name, 'utcpConfigPath', path);
        console.log(`[UtcpConfigManager] Config path updated to: ${path}`);
    }

    readConfig(): any {
        const path = this.getConfigPath();
        if (path && existsSync(path)) {
            try {
                const content = readFileSync(path, 'utf-8');
                const parsed = JSON.parse(content);
                // Strict cutover: legacy names are no longer supported. If the
                // file still carries any, purge them now so they can never cause
                // a duplicate URL / double tool registration again.
                if (this.purgeLegacyIfNeeded(parsed)) {
                    this.writeConfig(parsed);
                    console.log('[UtcpConfigManager] Purged legacy cc-bridge templates (cutover to ccb3x/ccb2x only)');
                }
                return parsed;
            } catch (e) {
                console.error('[UtcpConfigManager] Failed to parse UTCP config:', e);
                return { manual_call_templates: [] };
            }
        }
        return { manual_call_templates: [] };
    }

    /**
     * Returns true if any legacy entry was removed. The caller must persist
     * the config when true.
     */
    private purgeLegacyIfNeeded(config: any): boolean {
        if (!Array.isArray(config.manual_call_templates)) return false;
        const before = config.manual_call_templates.length;
        const VALID = /^ccb[23]x(_\d+)?$/;
        config.manual_call_templates = config.manual_call_templates.filter((t: any) => {
            const name: string = t.name || '';
            // Keep non-ccb entries (other MCP servers) and valid ccb* names.
            if (!name.startsWith('ccb') && !name.startsWith('cc-bridge') && name !== 'cc3x7' && name !== 'cc2x4') return true;
            return VALID.test(name);
        });
        return config.manual_call_templates.length !== before;
    }

    writeConfig(config: any): void {
        const path = this.getConfigPath();
        if (!path) {
            console.error('[UtcpConfigManager] Config path is not set');
            return;
        }
        try {
            writeFileSync(path, JSON.stringify(config, null, 2));
            console.log(`[UtcpConfigManager] Saved UTCP config to ${path}`);
        } catch (e) {
            console.error('[UtcpConfigManager] Failed to write UTCP config:', e);
        }
    }

    private portOf(url: string): number {
        const m = String(url || '').match(/localhost:(\d+)/);
        return m ? Number(m[1]) : 0;
    }

    private makeTemplate(name: string, port: number): any {
        return {
            name,
            call_template_type: 'http',
            url: `http://localhost:${port}/utcp`,
            http_method: 'GET',
            content_type: 'application/json',
        };
    }

    /**
     * Multi-editor rendezvous. The config file is shared between every running
     * editor and every Claude terminal, so each editor gets its own entry keyed
     * by port: `ccb3x_<port>`. The bare canonical name `ccb3x` is a "latest"
     * pointer kept for backward compat with `ccb3x.*` prompts.
     *
     * Invariant: no two entries share a URL — that is what caused the double
     * tool registration. When this editor becomes active it claims the bare
     * `ccb3x` name and demotes the previous latest to `ccb3x_<itsPort>`.
     */
    async ensureCocosEditorTemplate(port: number): Promise<boolean> {
        if (!port || port <= 0) {
            console.warn('[UtcpConfigManager] Invalid port provided:', port);
            return false;
        }

        const config = this.readConfig();
        const list: any[] = Array.isArray(config.manual_call_templates) ? config.manual_call_templates : [];
        const before = JSON.stringify(list);

        const CANON = UtcpConfigManager.CANON;
        const LEGACY = UtcpConfigManager.LEGACY;

        // Keep non-cc-bridge-3x entries untouched (other MCP servers, the 2x
        // generation, user-added templates, etc.).
        const is3xFamily = (t: any) =>
            LEGACY.has(t.name) ||
            t.name === CANON ||
            (typeof t.name === 'string' && t.name.startsWith(`${CANON}_`));

        const others = list.filter((t) => !is3xFamily(t));
        const family = list.filter((t) => is3xFamily(t));

        const rebuilt: any[] = [];
        for (const t of family) {
            if (LEGACY.has(t.name)) continue; // drop legacy names
            const tPort = this.portOf(t.url);
            if (t.name === CANON) {
                if (tPort === port) continue; // it's me restarting; rewrite below
                rebuilt.push(this.makeTemplate(`${CANON}_${tPort}`, tPort)); // demote previous latest
            } else if (t.name === `${CANON}_${port}` || tPort === port) {
                continue; // stale/duplicate entry for my own port
            } else {
                rebuilt.push(t); // another live editor
            }
        }
        rebuilt.push(this.makeTemplate(CANON, port)); // claim the latest pointer

        config.manual_call_templates = [...others, ...rebuilt];
        const changed = JSON.stringify(config.manual_call_templates) !== before;
        if (changed) {
            this.writeConfig(config);
            console.log(`[UtcpConfigManager] ${CANON} -> ${port} (latest); other editors kept as ${CANON}_<port>`);
        }
        return changed;
    }

    /**
     * Called on editor unload: drop this editor's entries. If it held the bare
     * `ccb3x` latest pointer, promote a remaining per-port editor so `ccb3x.*`
     * keeps resolving instead of pointing at a dead server.
     */
    async removeCocosEditorTemplate(port: number): Promise<boolean> {
        if (!port || port <= 0) return false;

        const config = this.readConfig();
        if (!Array.isArray(config.manual_call_templates)) return false;
        const list: any[] = config.manual_call_templates;
        const before = JSON.stringify(list);

        const CANON = UtcpConfigManager.CANON;

        // Drop my per-port entry.
        config.manual_call_templates = list.filter((t: any) => t.name !== `${CANON}_${port}`);

        // If I was the latest, remove the bare pointer and promote a survivor.
        const bareIdx = config.manual_call_templates.findIndex((t: any) => t.name === CANON);
        if (bareIdx !== -1 && this.portOf(config.manual_call_templates[bareIdx].url) === port) {
            config.manual_call_templates.splice(bareIdx, 1);
            const nextIdx = config.manual_call_templates.findIndex(
                (t: any) => typeof t.name === 'string' && t.name.startsWith(`${CANON}_`)
            );
            if (nextIdx !== -1) {
                config.manual_call_templates[nextIdx].name = CANON; // promote a survivor
            }
        }

        const changed = JSON.stringify(config.manual_call_templates) !== before;
        if (changed) this.writeConfig(config);
        return changed;
    }

    async getCurrentPort(): Promise<number> {
        const port = await Editor.Profile.getConfig(packageJSON.name, 'serverPort');
        return typeof port === 'number' ? port : 0;
    }

    async updatePort(port: number): Promise<void> {
        await Editor.Profile.setConfig(packageJSON.name, 'serverPort', port);
        await this.ensureCocosEditorTemplate(port);
    }

    // Tool profile config persistence
    async getToolProfileConfig(): Promise<{ profile: string, enabled: string[], disabled: string[], envelope: boolean }> {
        const profile = await Editor.Profile.getConfig(packageJSON.name, 'toolProfile') as string || 'full';
        const enabled = await Editor.Profile.getConfig(packageJSON.name, 'enabledTools') as string[] || [];
        const disabled = await Editor.Profile.getConfig(packageJSON.name, 'disabledTools') as string[] || [];
        const envelope = await Editor.Profile.getConfig(packageJSON.name, 'responseEnvelope') as boolean || false;
        return { profile, enabled, disabled, envelope };
    }

    async setToolProfileConfig(config: { profile: string, enabled: string[], disabled: string[], envelope: boolean }): Promise<void> {
        await Editor.Profile.setConfig(packageJSON.name, 'toolProfile', config.profile);
        await Editor.Profile.setConfig(packageJSON.name, 'enabledTools', config.enabled);
        await Editor.Profile.setConfig(packageJSON.name, 'disabledTools', config.disabled);
        await Editor.Profile.setConfig(packageJSON.name, 'responseEnvelope', config.envelope);
        console.log(`[UtcpConfigManager] Tool profile config saved: profile=${config.profile}, envelope=${config.envelope}`);
    }
}

export function getConfigManager(): UtcpConfigManager {
    return UtcpConfigManager.getInstance();
}
