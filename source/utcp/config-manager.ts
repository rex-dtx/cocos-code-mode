import { join, normalize } from 'path';
import { homedir } from 'os';
import { connect } from 'net';
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
    async ensureCocosEditorTemplate(port: number, instanceId: string, projectPath?: string): Promise<boolean> {
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[a-f0-9]{32}$/.test(instanceId)) {
            throw new Error('Publishing CCB requires a bound port and a valid instanceId.');
        }
        const closed = await this.findClosedCcbPorts();
        const project = typeof projectPath === 'string' && projectPath ? normalize(projectPath) : undefined;
        return this.mutateConfig(config => {
            const templates = new Map<string, Registry['manual_call_templates'][number]>();
            const others: Registry['manual_call_templates'] = [];
            for (const template of config.manual_call_templates) {
                if (['cc-bridge-3x', 'cc3x7', 'ccb-3x', 'ccb_3x'].includes(template.name)) continue;
                if (template.name === 'ccb3x' || /^ccb3x_\d+$/.test(template.name)) {
                    const url = new URL(template.url ?? '');
                    const endpointPort = Number(url.port);
                    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || endpointPort < 1) {
                        throw new Error('Invalid CCB endpoint in registry.');
                    }
                    const observedOwner = closed.get(endpointPort);
                    if (endpointPort !== port && closed.has(endpointPort)
                        && config.variables?.['CCB3X_OWNER_' + endpointPort] === observedOwner) {
                        delete config.variables?.['CCB3X_OWNER_' + endpointPort];
                        delete config.variables?.['CCB3X_PROJECT_' + endpointPort];
                        continue;
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
            config.variables = { ...config.variables, ['CCB3X_OWNER_' + port]: instanceId };
            if (project) config.variables['CCB3X_PROJECT_' + port] = project;
        });
    }
    private async findClosedCcbPorts(): Promise<Map<number, string | undefined>> {
        const config = this.readConfig();
        const ports = [...new Set(config.manual_call_templates.flatMap(template => {
            const match = /^ccb3x_(\d+)$/.exec(template.name);
            return match ? [Number(match[1])] : [];
        }).filter(port => Number.isInteger(port) && port > 0 && port <= 65535))];
        const results = await Promise.all(ports.map(async port => ({
            port, closed: await this.isLoopbackPortClosed(port), owner: config.variables?.['CCB3X_OWNER_' + port],
        })));
        return new Map(results.filter(result => result.closed).map(result => [result.port, result.owner]));
    }
    private isLoopbackPortClosed(port: number): Promise<boolean> {
        // Creator 3.7's Node runtime has no Promise.withResolvers.
        return new Promise(resolve => {
            const socket = connect({ host: '127.0.0.1', port });
            let settled = false;
            const finish = (closed: boolean) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(closed);
            };
            socket.setTimeout(250, () => finish(false));
            socket.once('connect', () => finish(false));
            socket.once('error', error => finish(error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED'));
        });
    }
    async removeCocosEditorTemplate(port: number, instanceId: string, configPath = this.getConfigPath()): Promise<boolean> {
        return mutateRegistry(configPath, config => {
            const key = 'CCB3X_OWNER_' + port;
            if (!instanceId || config.variables?.[key] !== instanceId) return;
            config.manual_call_templates = config.manual_call_templates.filter(t => t.name !== 'ccb3x_' + port);
            delete config.variables[key];
            delete config.variables?.['CCB3X_PROJECT_' + port];
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
    async getLastAutoPort(): Promise<number> {
        const port = await Editor.Profile.getConfig(packageJSON.name, 'lastAutoServerPort');
        return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
    }
    async setLastAutoPort(port: number): Promise<void> {
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Auto port must be a bound port.');
        await Editor.Profile.setConfig(packageJSON.name, 'lastAutoServerPort', port);
    }
    async updatePort(port: number, instanceId: string): Promise<void> {
        await this.ensureCocosEditorTemplate(port, instanceId, typeof Editor.Project?.path === 'string' ? Editor.Project.path : undefined);
    }
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
export function getConfigManager(): UtcpConfigManager { return UtcpConfigManager.getInstance(); }
