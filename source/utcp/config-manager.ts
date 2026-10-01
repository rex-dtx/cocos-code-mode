import { readFileSync, writeFileSync, existsSync, promises as fs } from 'fs';
import { join, dirname, normalize, isAbsolute } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const PKG_NAME = 'cocos-pilot-2x';
const PROFILE_URL = `profile://project/${PKG_NAME}.json`;
const LEGACY_PROFILE_URL = 'profile://project/cc-bridge-2x.json';
const DEFAULT_FILENAME = '.utcp_config.json';

interface IProfile2x {
    get(key: string): any;
    set(key: string, value: any): void;
    save(): void;
}


interface RegistryTemplate { name: string; url?: string; [key: string]: unknown }
interface Registry { manual_call_templates: RegistryTemplate[]; variables?: Record<string, string>; [key: string]: unknown }

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
                // Read the previous package profile only to migrate missing settings;
                // subsequent reads and all writes use the new package identity.
                const port = this.profile.get('serverPort');
                const path = this.profile.get('utcpConfigPath');
                if (!this.profile.get('legacyProfileMigrated')) {
                    try {
                        if (!Number.isInteger(port) || port <= 0 || !path) {
                            const legacy = Editor.Profile.load(LEGACY_PROFILE_URL, { serverPort: 0, utcpConfigPath: '' });
                            const legacyPort = legacy.get('serverPort');
                            const legacyPath = legacy.get('utcpConfigPath');
                            let migrated = false;
                            if ((!Number.isInteger(port) || port <= 0) && Number.isInteger(legacyPort) && legacyPort > 0 && legacyPort <= 65535) {
                                this.profile.set('serverPort', legacyPort);
                                migrated = true;
                            }
                            if (!path && typeof legacyPath === 'string' && legacyPath && isAbsolute(legacyPath)) {
                                this.profile.set('utcpConfigPath', legacyPath);
                                migrated = true;
                            }
                            if (migrated) console.log(`[${PKG_NAME}] Migrated legacy profile cc-bridge-2x.json`);
                        }
                    } catch (error) {
                        Editor.warn(`[${PKG_NAME}] Could not read legacy profile: ${error}`);
                    } finally {
                        this.profile.set('legacyProfileMigrated', true);
                        this.profile.save();
                    }
                }
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

    getPreference(key: string, fallback: any = null): any {
        return this.readSetting(key, fallback);
    }

    setPreference(key: string, value: any): boolean {
        const profile = this.getProfile();
        if (!profile) {
            return false;
        }
        this.writeSetting(key, value);
        return true;
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
        if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('UTCP config path must be absolute.');
        this.configPath = path;
        this.writeSetting('utcpConfigPath', path);
        console.log(`[UtcpConfigManager] Config path updated to: ${path}`);
    }

    readConfig(): Registry {
        const path = this.getConfigPath();
        let value: unknown;
        try { value = JSON.parse(readFileSync(path, 'utf8')); }
        catch (error: unknown) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { manual_call_templates: [] };
            throw error;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || !('manual_call_templates' in value) || !Array.isArray(value.manual_call_templates)
            || value.manual_call_templates.some((entry: unknown) => !entry || typeof entry !== 'object' || Array.isArray(entry)
                || !('name' in entry) || typeof entry.name !== 'string' || ('url' in entry && typeof entry.url !== 'string'))
            || ('variables' in value && (value.variables === null || typeof value.variables !== 'object' || Array.isArray(value.variables)
                || Object.values(value.variables).some(item => typeof item !== 'string')))) {
            throw new Error(`Invalid UTCP registry: ${path}`);
        }
        return value as Registry;
    }
    async writeConfig(config: unknown): Promise<void> {
        if (!config || typeof config !== 'object' || !('manual_call_templates' in config)
            || !Array.isArray(config.manual_call_templates)) {
            throw new Error('Invalid UTCP config.');
        }
        const requested = config.manual_call_templates as RegistryTemplate[];
        if (requested.some(entry => !entry || typeof entry.name !== 'string' || (entry.url !== undefined && typeof entry.url !== 'string'))) {
            throw new Error('Invalid UTCP template.');
        }
        await this.mutateRegistry(this.getConfigPath(), current => {
            for (const entry of requested) {
                if (!/^(ccp2x|ccb2x)_\d+$/.test(entry.name) && !['ccp2x', 'ccb2x', 'cc-bridge-2x', 'ccb-2x', 'ccb_2x', 'cc_bridge_2x'].includes(entry.name)) continue;
                const matching = current.manual_call_templates.filter(previous => previous.name === entry.name);
                if (matching.length !== 1 || matching[0].url !== entry.url || requested.filter(other => other.name === entry.name).length !== 1) {
                    throw new Error(`Cannot create or change reserved template ${entry.name} from the panel.`);
                }
            }
            const protectedTemplates = current.manual_call_templates.filter(entry => /^(ccp2x|ccb2x)_\d+$/.test(entry.name));
            const reservedNames = new Set(['ccp2x', 'ccb2x', 'cc-bridge-2x', 'ccb-2x', 'ccb_2x', 'cc_bridge_2x', ...protectedTemplates.map(entry => entry.name)]);
            current.manual_call_templates = [...requested.filter(entry => !reservedNames.has(entry.name) && !/^(ccp2x|ccb2x)_\d+$/.test(entry.name)),
                ...current.manual_call_templates.filter(entry => reservedNames.has(entry.name))];
            const incoming = 'variables' in config && config.variables && typeof config.variables === 'object' && !Array.isArray(config.variables)
                ? config.variables as Record<string, string> : {};
            const variables = { ...incoming };
            for (const key of Object.keys(variables)) {
                if (/^(CCP2X|CCB2X)_(OWNER|PROJECT)_\d+$/.test(key)) delete variables[key];
            }
            const protectedVariables: Record<string, string> = {};
            for (const [key, value] of Object.entries(current.variables ?? {})) {
                if (/^(CCP2X|CCB2X)_(OWNER|PROJECT)_\d+$/.test(key)) protectedVariables[key] = value;
            }
            current.variables = { ...variables, ...protectedVariables };
        });
    }

    private async mutateRegistry(path: string, mutate: (config: Registry) => void): Promise<boolean> {
        // Share the 3x registry lock: two editors must never read the same old snapshot and overwrite each other.
        const lock = `${path}.ccp-lock`;
        await fs.mkdir(dirname(path), { recursive: true });
        const deadline = Date.now() + 5000;
        for (;;) {
            try { await fs.mkdir(lock); break; }
            catch (error: unknown) {
                if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
                if (Date.now() >= deadline) throw new Error(`UTCP registry locked: ${lock}`);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
        const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
        try {
            let value: unknown = { manual_call_templates: [] };
            try { value = JSON.parse(await fs.readFile(path, 'utf8')); }
            catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
            if (!value || typeof value !== 'object' || Array.isArray(value)
                || !('manual_call_templates' in value) || !Array.isArray(value.manual_call_templates)
                || value.manual_call_templates.some((entry: unknown) => !entry || typeof entry !== 'object' || Array.isArray(entry)
                    || !('name' in entry) || typeof entry.name !== 'string'
                    || ('url' in entry && typeof entry.url !== 'string'))
                || ('variables' in value && (value.variables === null || typeof value.variables !== 'object' || Array.isArray(value.variables)
                    || Object.values(value.variables).some(item => typeof item !== 'string')))) {
                throw new Error(`Invalid UTCP registry: ${path}`);
            }
            // The validated JSON shape is the only writer-visible registry value.
            const config = value as Registry;
            const before = JSON.stringify(config);
            mutate(config);
            if (JSON.stringify(config) === before) return false;
            const file = await fs.open(temporary, 'wx');
            try { await file.writeFile(JSON.stringify(config, null, 2), 'utf8'); await file.sync(); }
            finally { await file.close(); }
            await fs.rename(temporary, path);
            return true;
        } finally {
            try { await fs.unlink(temporary); } catch (error: unknown) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') console.warn(`[${PKG_NAME}] Temporary registry cleanup failed: ${error}`); }
            await fs.rmdir(lock);
        }
    }

    async ensureCocosEditorTemplate(port: number, instanceId: string, projectPath: string): Promise<boolean> {
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{32}$/.test(instanceId)
            || typeof projectPath !== 'string' || !isAbsolute(projectPath)) {
            throw new Error('Publishing ccp2x requires a bound port, instance identity, and absolute project path.');
        }
        return this.mutateRegistry(this.getConfigPath(), config => {
            const templates = config.manual_call_templates;
            const name = `ccp2x_${port}`;
            const owner = `CCP2X_OWNER_${port}`;
            const project = `CCP2X_PROJECT_${port}`;
            if (config.variables?.[`CCB2X_OWNER_${port}`] !== undefined || config.variables?.[`CCB2X_PROJECT_${port}`] !== undefined
                || templates.some(entry => entry.name === `ccb2x_${port}`)) {
                throw new Error(`Legacy registration already claims port ${port}; refusing unowned takeover.`);
            }
            const normalizedProject = normalize(projectPath).replace(/[\\/]+$/, '');
            const compareProject = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
            // A foreign claim must not be overwritten, even if the process occupying its port changed.
            if (config.variables?.[owner] && config.variables[owner] !== instanceId) {
                throw new Error(`Registry port ${port} belongs to another editor instance; refusing takeover.`);
            }
            if (config.variables?.[project] && compareProject(normalize(config.variables[project]).replace(/[\\/]+$/, '')) !== compareProject(normalizedProject)) {
                throw new Error(`Registry port ${port} belongs to another project; refusing takeover.`);
            }
            if (config.variables?.[project] && !config.variables?.[owner]) {
                throw new Error(`Registry port ${port} has a project claim without an instance owner; refusing takeover.`);
            }
            if (config.variables?.[owner] === instanceId && config.variables?.[project] === undefined) {
                throw new Error(`Registry port ${port} lacks a verifiable project owner; refusing takeover.`);
            }
            if (templates.some(entry => entry.name === name) && !config.variables?.[owner]) {
                throw new Error(`Registry namespace ${name} has no verifiable owner; refusing takeover.`);
            }
            if (config.variables?.[owner] === instanceId) {
                const owned = templates.filter(entry => entry.name === name);
                if (owned.length !== 1 || owned[0].url !== `http://localhost:${port}/utcp`) {
                    throw new Error(`Registry namespace ${name} no longer points at this editor; refusing takeover.`);
                }
            }
            if (templates.some(entry => ['cc-bridge-2x', 'ccb2x', 'ccb-2x', 'ccb_2x', 'cc_bridge_2x'].includes(entry.name)
                && (entry.url === `http://localhost:${port}/utcp` || entry.url === `http://127.0.0.1:${port}/utcp`))) {
                throw new Error(`Legacy alias already targets port ${port}; refusing unowned takeover.`);
            }
            const template = { name, call_template_type: 'http', url: `http://localhost:${port}/utcp`, http_method: 'GET', content_type: 'application/json' };
            const index = templates.findIndex(entry => entry.name === name);
            if (index < 0) templates.push(template);
            else templates[index] = template;
            config.variables = { ...config.variables, [owner]: instanceId, [project]: normalizedProject };
            // Bare aliases are unowned; leave other editor registrations untouched.
        });
    }

    async removeCocosEditorTemplate(port: number, instanceId: string, configPath = this.getConfigPath()): Promise<boolean> {
        if (!port || !instanceId) return false;
        return this.mutateRegistry(configPath, config => {
            const owner = `CCP2X_OWNER_${port}`;
            if (config.variables?.[owner] !== instanceId) return;
            const entries = config.manual_call_templates.filter(entry => entry.name === `ccp2x_${port}`);
            if (entries.length !== 1 || entries[0].url !== `http://localhost:${port}/utcp`) return;
            config.manual_call_templates = config.manual_call_templates.filter(entry => entry.name !== `ccp2x_${port}`);
            delete config.variables[owner];
            delete config.variables[`CCP2X_PROJECT_${port}`];
        });
    }

    async getCurrentPort(): Promise<number> {
        const port = this.readSetting<number>('serverPort', 0);
        return typeof port === 'number' ? port : 0;
    }

    async updatePort(port: number, instanceId: string, projectPath: string): Promise<void> {
        await this.ensureCocosEditorTemplate(port, instanceId, projectPath);
        this.writeSetting('serverPort', port);
    }
}

export function getConfigManager(): UtcpConfigManager {
    return UtcpConfigManager.getInstance();
}
