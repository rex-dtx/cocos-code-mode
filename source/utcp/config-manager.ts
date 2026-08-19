import { readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';
import { homedir } from 'os';

const PKG_NAME = 'cocos-code-mode-2x';
const PROFILE_URL = `profile://project/${PKG_NAME}.json`;
const DEFAULT_FILENAME = '.utcp_config.json';

interface IProfile2x {
    get(key: string): any;
    set(key: string, value: any): void;
    save(): void;
}


export class UtcpConfigManager {
    private static instance: UtcpConfigManager;
    private configPath: string = '';
    private profile: IProfile2x | null = null;

    private constructor() {}

    static getInstance(): UtcpConfigManager {
        if (!UtcpConfigManager.instance) {
            UtcpConfigManager.instance = new UtcpConfigManager();
        }
        return UtcpConfigManager.instance;
    }

    // Profile 2.x: load(url, default) tra ve mot EventEmitter co get/set/save tren prototype.
    // GAN THANG property (profile.serverPort = x) KHONG persist — save() serialize _chain,
    // khong doc own-property. PHAI dung .set(key, value) roi .save().
    // Verify bang probe runtime 2.4.15; docs khong noi ro. Doc: main/profile.md
    private getProfile(): IProfile2x | null {
        if (this.profile === null) {
            try {
                this.profile = Editor.Profile.load(PROFILE_URL, {
                    serverPort: 0,
                    utcpConfigPath: '',
                });
            } catch (e) {
                Editor.warn(`[${PKG_NAME}] Profile unavailable, settings will not persist: ${e}`);
            }
        }
        return this.profile;
    }

    private readSetting<T>(key: string, fallback: T): T {
        const value = this.getProfile()?.get(key);
        return value === undefined || value === null ? fallback : value as T;
    }

    private writeSetting(key: string, value: any): void {
        const profile = this.getProfile();
        if (!profile) {
            return;
        }
        profile.set(key, value);
        profile.save();
    }

    async initialize(): Promise<void> {
        const savedPath = this.readSetting<string>('utcpConfigPath', '');
        if (savedPath && typeof savedPath === 'string') {
            this.configPath = savedPath;
        } else {
            this.configPath = join(homedir(), DEFAULT_FILENAME);
        }
        console.log(`[UtcpConfigManager] Initialized with config path: ${this.configPath}`);
    }

    getConfigPath(): string {
        if (!this.configPath) {
            this.configPath = join(homedir(), DEFAULT_FILENAME);
        }
        return this.configPath;
    }

    async setConfigPath(path: string): Promise<void> {
        this.configPath = path;
        this.writeSetting('utcpConfigPath', path);
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

        const templates = config.manual_call_templates;
        const NAME = 'cc2x4';
        const LEGACY_NAMES = ['cc24', 'CocosEditor', 'CocosEditor2x'];
        let idx = templates.findIndex((t: any) => t.name === NAME);
        if (idx === -1) {
            for (const legacy of LEGACY_NAMES) {
                idx = templates.findIndex((t: any) => t.name === legacy);
                if (idx !== -1) {
                    templates[idx].name = NAME;
                    console.log(`[UtcpConfigManager] Migrated template name ${legacy} -> ${NAME}`);
                    break;
                }
            }
        }

        let changed = false;
        if (idx === -1) {
            templates.push({
                name: NAME,
                call_template_type: 'http',
                url: expectedUrl,
                http_method: 'GET',
                content_type: 'application/json',
            });
            changed = true;
            console.log(`[UtcpConfigManager] Created ${NAME} template with port ${port}`);
        } else {
            if (templates[idx].url !== expectedUrl) {
                templates[idx].url = expectedUrl;
                changed = true;
                console.log(`[UtcpConfigManager] Updated ${NAME} template port to ${port}`);
            }
        }

        if (changed) {
            this.writeConfig(config);
        }

        return changed;
    }

    async getCurrentPort(): Promise<number> {
        const port = this.readSetting<number>('serverPort', 0);
        return typeof port === 'number' ? port : 0;
    }

    async updatePort(port: number): Promise<void> {
        this.writeSetting('serverPort', port);
        await this.ensureCocosEditorTemplate(port);
    }
}

export function getConfigManager(): UtcpConfigManager {
    return UtcpConfigManager.getInstance();
}
