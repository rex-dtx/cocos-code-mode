import { join } from 'path';
import { homedir } from 'os';
import packageJSON from '../../package.json';
import { Registry, readRegistry, mutateRegistry } from './config-transaction';

export class UtcpConfigManager {
    private static instance: UtcpConfigManager;
    private configPath = '';
    private constructor() {}
    static getInstance(): UtcpConfigManager {
        if (!this.instance) this.instance = new UtcpConfigManager();
        return this.instance;
    }
    async initialize(): Promise<void> {
        const saved = await Editor.Profile.getConfig(packageJSON.name, 'utcpConfigPath');
        this.configPath = typeof saved === 'string' && saved ? saved : join(homedir(), '.utcp_config.json');
    }
    getConfigPath(): string {
        if (!this.configPath) this.configPath = join(homedir(), '.utcp_config.json');
        return this.configPath;
    }
    async setConfigPath(path: string): Promise<void> {
        await Editor.Profile.setConfig(packageJSON.name, 'utcpConfigPath', path);
        this.configPath = path;
    }
    readConfig(): Registry { return readRegistry(this.getConfigPath()); }
    mutateConfig(mutator: (config: Registry) => void): Promise<boolean> {
        return mutateRegistry(this.getConfigPath(), mutator);
    }
    async ensureCocosEditorTemplate(port: number, instanceId: string): Promise<boolean> {
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{32}$/.test(instanceId)) {
            throw new Error('Publishing CCB requires a bound port and a valid instanceId.');
        }
        return this.mutateConfig(config => {
            const templates = new Map<string, Registry['manual_call_templates'][number]>();
            const others: Registry['manual_call_templates'] = [];
            for (const template of config.manual_call_templates) {
                if (['cc-bridge-3x', 'cc3x7', 'ccb-3x', 'ccb_3x'].includes(template.name)) continue;
                if (template.name === 'ccb3x' || /^ccb3x_\d+$/.test(template.name)) {
                    // Convert the old latest pointer once, preserving the endpoint,
                    // never promoting or redirecting another editor's namespace.
                    const url = new URL(template.url ?? '');
                    const endpointPort = Number(url.port);
                    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || endpointPort < 1) {
                        throw new Error('Invalid CCB endpoint in registry.');
                    }
                    const name = 'ccb3x_' + endpointPort;
                    templates.set(name, { ...template, name });
                } else others.push(template);
            }
            const name = 'ccb3x_' + port;
            templates.set(name, {
                name, call_template_type: 'http', url: 'http://localhost:' + port + '/utcp',
                http_method: 'GET', content_type: 'application/json',
            });
            config.manual_call_templates = [...others, ...templates.values()];
            // UTCP's root and template schemas are strict; variables is its supported
            // string metadata map. Commit ownership and endpoint in the same rename.
            config.variables = { ...config.variables, ['CCB3X_OWNER_' + port]: instanceId };
        });
    }
    async removeCocosEditorTemplate(port: number, instanceId: string, configPath = this.getConfigPath()): Promise<boolean> {
        return mutateRegistry(configPath, config => {
            const key = 'CCB3X_OWNER_' + port;
            if (!instanceId || config.variables?.[key] !== instanceId) return;
            config.manual_call_templates = config.manual_call_templates.filter(t => t.name !== 'ccb3x_' + port);
            delete config.variables[key];
        });
    }
    async getCurrentPort(): Promise<number> {
        const port = await Editor.Profile.getConfig(packageJSON.name, 'fixedServerPort');
        if (port === undefined || port === null) return 0;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('fixedServerPort must be an integer from 0 to 65535.');
        return port;
    }
    async setConfiguredPort(port: number): Promise<void> {
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
        await Editor.Profile.setConfig(packageJSON.name, 'fixedServerPort', port);
    }
    async updatePort(port: number, instanceId: string): Promise<void> {
        await this.ensureCocosEditorTemplate(port, instanceId);
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
        console.log(`[cx3][config] Tool profile config saved: profile=${config.profile}, envelope=${config.envelope}`);
    }
}

export function getConfigManager(): UtcpConfigManager {
    return UtcpConfigManager.getInstance();
}
