import { readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';
import { homedir } from 'os';

// @ts-ignore
import packageJSON from '../../package.json';


export class UtcpConfigManager {
    private static instance: UtcpConfigManager;
    private static readonly CANON = 'ccp3x';
    private static readonly LEGACY_OLD = new Set(['cocos-pilot-3x', 'cocos-pilot-2x', 'cocos-pilot', 'ccp3x', 'ccp2x', 'ccb-3x', 'ccp_3x', 'cc3x7', 'cc2x4']);
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

    readConfig(): Record<string, unknown> & { manual_call_templates?: Array<Record<string, unknown>> } {
        const path = this.getConfigPath();
        if (path && existsSync(path)) {
            try {
                const content = readFileSync(path, 'utf-8');
                const parsed = JSON.parse(content) as Record<string, unknown>;
                if (this.purgeLegacyIfNeeded(parsed)) {
                    this.writeConfig(parsed);
                    console.log('[UtcpConfigManager] Purged legacy templates (cutover to ccp3x/ccp2x only)');
                }
                return parsed as Record<string, unknown> & { manual_call_templates?: Array<Record<string, unknown>> };
            } catch (e) {
                console.error('[UtcpConfigManager] Failed to parse UTCP config:', e);
                return { manual_call_templates: [] };
            }
        }
        return { manual_call_templates: [] };
    }

    /**
     * Returns true if any legacy entry was removed. Hard cut 2.1.0: ccb* is now legacy.
     */
    private purgeLegacyIfNeeded(config: Record<string, unknown>): boolean {
        const raw = (config as { manual_call_templates?: unknown }).manual_call_templates;
        if (!Array.isArray(raw)) return false;
        const list = raw as Array<Record<string, unknown>>;
        const before = list.length;
        const VALID = /^ccp[23]x(_\d+)?$/;
        const filtered = list.filter((t) => {
            const name = typeof t['name'] === 'string' ? (t['name'] as string) : '';
            if (UtcpConfigManager.LEGACY_OLD.has(name)) return false;
            if (name.startsWith('ccb') || name.startsWith('cocos-pilot') || name === 'cc3x7' || name === 'cc2x4') return false;
            if (name === 'ccp3x' || name === 'ccp2x' || name.startsWith('ccp3x_') || name.startsWith('ccp2x_')) return VALID.test(name);
            if (name.startsWith('ccp') || name.startsWith('cocos-pilot')) return VALID.test(name);
            return true;
        });
        (config as { manual_call_templates: Array<Record<string, unknown>> }).manual_call_templates = filtered;
        return filtered.length !== before;
    }

    writeConfig(config: Record<string, unknown>): void {
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

    private makeTemplate(name: string, port: number): Record<string, unknown> {
        return {
            name,
            call_template_type: 'http',
            url: `http://localhost:${port}/utcp`,
            http_method: 'GET',
            content_type: 'application/json',
        };
    }

    /**
     * Multi-editor rendezvous. Each editor gets its own entry keyed by port: `ccp3x_<port>`.
     * Hard cut 2.1.0: no ccb* alias, only ccp3x.
     *
     * Invariant: no two entries share a URL.
     */
    async ensureCocosEditorTemplate(port: number): Promise<boolean> {
        if (!port || port <= 0) {
            console.warn('[UtcpConfigManager] Invalid port provided:', port);
            return false;
        }

        const config = this.readConfig();
        const list = Array.isArray(config.manual_call_templates) ? config.manual_call_templates as Array<Record<string, unknown>> : [];
        const before = JSON.stringify(list);

        const CANON = UtcpConfigManager.CANON;

        const is3xFamily = (t: Record<string, unknown>): boolean =>
            UtcpConfigManager.LEGACY_OLD.has(typeof t['name'] === 'string' ? (t['name'] as string) : '') ||
            t['name'] === CANON ||
            (typeof t['name'] === 'string' && (t['name'] as string).startsWith(`${CANON}_`));

        const others = list.filter((t) => !is3xFamily(t));
        const family = list.filter((t) => is3xFamily(t));

        const rebuilt: Array<Record<string, unknown>> = [];
        for (const t of family) {
            if (UtcpConfigManager.LEGACY_OLD.has(typeof t['name'] === 'string' ? (t['name'] as string) : '')) continue;
            const tPort = this.portOf(typeof t['url'] === 'string' ? (t['url'] as string) : '');
            const tName = typeof t['name'] === 'string' ? (t['name'] as string) : '';
            if (tName === CANON) {
                if (tPort === port) continue;
                rebuilt.push(this.makeTemplate(`${CANON}_${tPort}`, tPort));
            } else if (tName === `${CANON}_${port}` || tPort === port) {
                continue;
            } else {
                rebuilt.push(t);
            }
        }
        rebuilt.push(this.makeTemplate(CANON, port));

        (config as { manual_call_templates: Array<Record<string, unknown>> }).manual_call_templates = [...others, ...rebuilt];
        const changed = JSON.stringify((config as { manual_call_templates: unknown }).manual_call_templates) !== before;
        if (changed) {
            this.writeConfig(config);
            console.log(`[UtcpConfigManager] ${CANON} -> ${port} (latest); other editors kept as ${CANON}_<port>`);
        }
        return changed;
    }

    /**
     * Called on editor unload: drop this editor's entries.
     */
    async removeCocosEditorTemplate(port: number): Promise<boolean> {
        if (!port || port <= 0) return false;

        const config = this.readConfig();
        if (!Array.isArray(config.manual_call_templates)) return false;
        const list = config.manual_call_templates as Array<Record<string, unknown>>;
        const before = JSON.stringify(list);

        const CANON = UtcpConfigManager.CANON;

        (config as { manual_call_templates: Array<Record<string, unknown>> }).manual_call_templates = list.filter((t) => t['name'] !== `${CANON}_${port}`);

        const arr = (config as { manual_call_templates: Array<Record<string, unknown>> }).manual_call_templates;
        const bareIdx = arr.findIndex((t) => t['name'] === CANON);
        if (bareIdx !== -1 && this.portOf(typeof arr[bareIdx]['url'] === 'string' ? (arr[bareIdx]['url'] as string) : '') === port) {
            arr.splice(bareIdx, 1);
            const nextIdx = arr.findIndex(
                (t) => typeof t['name'] === 'string' && (t['name'] as string).startsWith(`${CANON}_`)
            );
            if (nextIdx !== -1) {
                arr[nextIdx]['name'] = CANON;
            }
        }

        const changed = JSON.stringify((config as { manual_call_templates: unknown }).manual_call_templates) !== before;
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
