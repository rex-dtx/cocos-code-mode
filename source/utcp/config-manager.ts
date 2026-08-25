import { readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';
import { homedir } from 'os';

// @ts-ignore
import packageJSON from '../../package.json';


export class UtcpConfigManager {
    private static instance: UtcpConfigManager;
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
                return JSON.parse(content);
            } catch (e) {
                console.error('[UtcpConfigManager] Failed to parse UTCP config:', e);
                return { manual_call_templates: [] };
            }
        }
        return { manual_call_templates: [] };
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

    async ensureCocosEditorTemplate(port: number): Promise<boolean> {
        if (!port || port <= 0) {
            console.warn('[UtcpConfigManager] Invalid port provided:', port);
            return false;
        }

        const expectedUrl = `http://localhost:${port}/utcp`;
        const config = this.readConfig();
        if (!config.manual_call_templates) {
            config.manual_call_templates = [];
        }

        // Single canonical name for this generation. The config file is a shared
        // rendezvous (Editor -> N terminals) and must hold EXACTLY ONE template per
        // running server — duplicates are what caused double tool registration.
        // Legacy names are migrated to the canonical one and dropped on save.
        const CANON = 'ccb3x';
        const LEGACY = new Set(['cc-bridge-3x', 'cc3x7', 'ccb-3x', 'ccb_3x']);

        const before = JSON.stringify(config.manual_call_templates);
        // Remove every self/legacy entry and any entry pointing at this server's URL.
        config.manual_call_templates = config.manual_call_templates.filter((t: any) =>
            !(LEGACY.has(t.name) || t.name === CANON || t.url === expectedUrl)
        );
        // Push the single canonical entry.
        config.manual_call_templates.push({
            name: CANON,
            call_template_type: 'http',
            url: expectedUrl,
            http_method: 'GET',
            content_type: 'application/json',
        });

        const changed = JSON.stringify(config.manual_call_templates) !== before;
        if (changed) {
            this.writeConfig(config);
            console.log(`[UtcpConfigManager] Ensured single ${CANON} template -> ${expectedUrl}`);
        }
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
}

export function getConfigManager(): UtcpConfigManager {
    return UtcpConfigManager.getInstance();
}
