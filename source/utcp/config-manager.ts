import { closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// package.json is supplied by the extension build.
// @ts-ignore
import packageJSON from '../../package.json';


interface UtcpConfig {
    manual_call_templates: Array<Record<string, unknown>>;
    load_variables_from?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}

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

    readConfig(): UtcpConfig {
        const path = this.getConfigPath();
        if (path && existsSync(path)) {
            try {
                const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('UTCP config root must be an object');
                const config = parsed as UtcpConfig;
                if (!Array.isArray(config.manual_call_templates)) config.manual_call_templates = [];
                if (this.purgeLegacyIfNeeded(config)) {
                    this.writeConfig(config);
                    console.log('[UtcpConfigManager] Purged legacy cc-bridge templates (cutover to ccb3x/ccb2x only)');
                }
                return config;
            } catch (error) {
                console.error('[UtcpConfigManager] Failed to parse UTCP config:', error);
                return { manual_call_templates: [] };
            }
        }
        return { manual_call_templates: [] };
    }

    /**
     * Returns true if any legacy entry was removed. The caller must persist
     * the config when true.
     */
    private purgeLegacyIfNeeded(config: UtcpConfig): boolean {
        const before = config.manual_call_templates.length;
        const validName = /^ccb[23]x(_\d+)?$/;
        config.manual_call_templates = config.manual_call_templates.filter((template) => {
            const name = typeof template.name === 'string' ? template.name : '';
            if (!name.startsWith('ccb') && !name.startsWith('cc-bridge') && name !== 'cc3x7' && name !== 'cc2x4') return true;
            return validName.test(name);
        });
        return config.manual_call_templates.length !== before;
    }

    writeConfig(config: unknown): void {
        const path = this.getConfigPath();
        if (!path) {
            console.error('[UtcpConfigManager] Config path is not set');
            return;
        }
        const bytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
        const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
        let descriptor: number | undefined;
        try {
            descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            writeSync(descriptor, bytes, 0, bytes.length, 0);
            try { fsyncSync(descriptor); } catch { /* filesystem may not support fsync */ }
            closeSync(descriptor);
            descriptor = undefined;
            renameSync(temporary, path);
            console.log(`[UtcpConfigManager] Saved UTCP config to ${path}`);
        } catch (error) {
            console.error('[UtcpConfigManager] Failed to write UTCP config:', error);
            throw error;
        } finally {
            if (descriptor !== undefined) closeSync(descriptor);
            if (existsSync(temporary)) unlinkSync(temporary);
        }
    }

    private portOf(url: string): number {
        const match = String(url || '').match(/localhost:(\d+)/);
        return match ? Number(match[1]) : 0;
    }

    private makeTemplate(name: string, port: number): Record<string, unknown> {
        return {
            name,
            call_template_type: 'http',
            url: `http://localhost:${port}/utcp`,
            http_method: 'GET',
            content_type: 'application/json',
            headers: {
                'x-ccb-relay-instance': `\${CCB_RELAY_INSTANCE_ID}`,
                'x-ccb-bound-port': `\${CCB_BOUND_PORT}`,
            },
        };
    }

    /**
     * Registers one authenticated exact per-port rendezvous. Credentials are
     * resolved from its bound token file and never copied into config or manual.
     */
    async ensureCocosEditorTemplate(port: number, relayInstanceId?: string, tokenPath?: string): Promise<boolean> {
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
            console.warn('[UtcpConfigManager] Invalid port provided:', port);
            return false;
        }
        if ((relayInstanceId === undefined) !== (tokenPath === undefined)) {
            throw new Error('relay instance and local token path must be configured together');
        }
        if (!relayInstanceId || !tokenPath) {
            throw new Error('authenticated ccb3x rendezvous requires a relay instance and token path');
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(relayInstanceId)) {
            throw new Error('relay instance must be a UUID');
        }

        const config = this.readConfig();
        const list = config.manual_call_templates;
        const before = JSON.stringify({ templates: list, loaders: config.load_variables_from });
        const resolvedTokenPath = resolve(tokenPath);
        const loaders = Array.isArray(config.load_variables_from) ? config.load_variables_from : [];
        config.load_variables_from = [
            ...loaders.filter((loader) => loader.variable_loader_type !== 'dotenv' || resolve(String(loader.env_file_path)) !== resolvedTokenPath),
            { variable_loader_type: 'dotenv', env_file_path: resolvedTokenPath },
        ];

        const CANON = UtcpConfigManager.CANON;
        const family = (template: Record<string, unknown>) =>
            UtcpConfigManager.LEGACY.has(String(template.name)) ||
            template.name === CANON ||
            (typeof template.name === 'string' && template.name.startsWith(`${CANON}_`));
        const retained = list.filter((template) => {
            if (!family(template)) return true;
            if (UtcpConfigManager.LEGACY.has(String(template.name)) || template.name === CANON) return false;
            return template.name !== `${CANON}_${port}` && this.portOf(String(template.url || '')) !== port;
        });
        retained.push(this.makeTemplate(`${CANON}_${port}`, port));
        config.manual_call_templates = retained;

        const changed = JSON.stringify({ templates: retained, loaders: config.load_variables_from }) !== before;
        if (changed) {
            this.writeConfig(config);
            console.log(`[UtcpConfigManager] Registered authenticated ${CANON}_${port} rendezvous for relay ${relayInstanceId}`);
        }
        return changed;
    }

    async removeCocosEditorTemplate(port: number): Promise<boolean> {
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return false;
        const config = this.readConfig();
        if (!Array.isArray(config.manual_call_templates)) return false;
        const before = JSON.stringify(config.manual_call_templates);
        const CANON = UtcpConfigManager.CANON;
        const retained = config.manual_call_templates.filter((template: Record<string, unknown>) => {
            const templatePort = this.portOf(String(template.url || ''));
            return template.name !== `${CANON}_${port}` && !(template.name === CANON && templatePort === port);
        });
        config.manual_call_templates = retained;
        const changed = JSON.stringify(retained) !== before;
        if (changed) this.writeConfig(config);
        return changed;
    }

    async getCurrentPort(): Promise<number> {
        const port = await Editor.Profile.getConfig(packageJSON.name, 'serverPort');
        return typeof port === 'number' ? port : 0;
    }

    async updatePort(port: number, relayInstanceId?: string, tokenPath?: string): Promise<void> {
        await Editor.Profile.setConfig(packageJSON.name, 'serverPort', port);
        await this.ensureCocosEditorTemplate(port, relayInstanceId, tokenPath);
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
