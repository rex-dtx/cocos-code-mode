import packageJSON from '../package.json';
import { UtcpServerManager, setServerProfile } from './utcp/utcp-server';
import { closeArtifactServers } from './utcp/tools/artifact-server-tools';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo } from './build-info';
import { exec } from 'child_process';
import { homedir } from 'os';
import { join, isAbsolute } from 'path';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { cancelEditorAsk } from './utcp/editor-ask';
import { cancelEditorPrompt, getEditorPrompt, respondEditorPrompt } from './utcp/editor-prompt';
import { cancelEditorTask, disposeEditorControl, getEditorControl } from './utcp/editor-control-plane';
import { inspectExtensionStatus } from './extension-status';

let utcpServer: UtcpServerManager | null = null;
const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');
let lifecycle: Promise<unknown> = Promise.resolve();
const registryPaths = new WeakMap<UtcpServerManager, string>();

function runLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(operation);
    lifecycle = result.catch(() => {});
    return result;
}

async function stopPublishedServer(server: UtcpServerManager): Promise<void> {
    const { port, instanceId } = server;
    try {
        await server.stop();
    } finally {
        if (port > 0) await getConfigManager().removeCocosEditorTemplate(port, instanceId, registryPaths.get(server));
    }
}

async function startPublishedServer(port: number, debugLogging: boolean): Promise<number> {
    const server = new UtcpServerManager();
    server.setDebugEnabled(debugLogging);
    try {
        const actualPort = await server.start(port);
        registryPaths.set(server, getConfigManager().getConfigPath());
        await getConfigManager().updatePort(actualPort, server.instanceId);
        utcpServer = server;
        return actualPort;
    } catch (error) {
        try {
            await stopPublishedServer(server);
        } catch (cleanupError) {
            console.error('[cx3][api] Failed to clean up unpublished UTCP Server:', cleanupError);
            throw cleanupError;
        }
        throw error;
    }
}


export const methods: { [key: string]: (...any: any) => any } = {
    getEditorPrompt,
    respondEditorPrompt,
    getEditorControl,
    cancelEditorTask,
    openStatus() {
        return Editor.Panel.open(`${packageJSON.name}.status`);
    },
    async getExtensionStatus() {
        const server = utcpServer;
        const snapshot = await inspectExtensionStatus(server ? {
            port: server.port, instanceId: server.instanceId, debug: server.getDebugEnabled(),
        } : null, (server && registryPaths.get(server)) || getConfigManager().getConfigPath());
        if (server !== utcpServer || (server && server.instanceId !== snapshot.server.instanceId)) {
            snapshot.http = { status: 'error', detail: 'Server changed during this check. Check status again.' };
            snapshot.probe = null;
        }
        return snapshot;
    },
    openAgentInbox() {
        return Editor.Panel.open(`${packageJSON.name}.prompt`);
    },

    openPanel() {
        Editor.Panel.open(packageJSON.name + '.configuration');
    },
    async getExtensionSettings() {
        const config = getConfigManager();
        return { fixedPort: await config.getCurrentPort(), configPath: config.getConfigPath() };
    },
    async saveExtensionSettings(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some(key => key !== 'fixedPort' && key !== 'configPath')
            || !('fixedPort' in input) || typeof input.fixedPort !== 'number' || !Number.isInteger(input.fixedPort)
            || input.fixedPort < 0 || input.fixedPort > 65535
            || !('configPath' in input) || typeof input.configPath !== 'string' || !isAbsolute(input.configPath)
            || /[\0\r\n]/.test(input.configPath) || input.configPath.length > 4096) {
            throw new Error('Settings require fixedPort (0–65535) and an absolute configPath.');
        }
        const { fixedPort, configPath } = input;
        return runLifecycle(async () => {
            const config = getConfigManager();
            await config.setConfiguredPort(fixedPort);
            await config.setConfigPath(configPath);
            const previous = utcpServer;
            const debug = previous?.getDebugEnabled() ?? false;
            cancelEditorAsk();
            cancelEditorPrompt();
            utcpServer = null;
            if (previous) await stopPublishedServer(previous);
            await startPublishedServer(fixedPort, debug);
            return { fixedPort, configPath };
        });
    },

    openPreviewPanel() {
        Editor.Panel.open(packageJSON.name + '.preview');
    },


    async restartServer(newPort?: number) {
        return runLifecycle(async () => {
            const configManager = getConfigManager();
            const port = newPort === undefined ? await configManager.getCurrentPort() : newPort;
            if (!Number.isInteger(port) || port < 0 || port > 65535) {
                throw new RangeError('Port must be an integer between 0 and 65535 (0 = auto).');
            }
            if (newPort !== undefined) await configManager.setConfiguredPort(port);
            cancelEditorAsk();
            cancelEditorPrompt();
            const previousServer = utcpServer;
            const debugLogging = previousServer?.getDebugEnabled()
                ?? (await Editor.Profile.getConfig(packageJSON.name, 'debugLogging') === true);
            utcpServer = null;
            try {
                if (previousServer) await stopPublishedServer(previousServer);
                const actualPort = await startPublishedServer(port, debugLogging);
                console.log(`[cx3][api] UTCP Server restarted on port ${actualPort}`);
                return actualPort;
            } catch (err) {
                console.error('[cx3][api] Failed to restart UTCP Server:', err);
                throw err;
            }
        });
    },

    async getDebugLogging() {
        const enabled = Boolean(await Editor.Profile.getConfig(packageJSON.name, 'debugLogging'));
        return { enabled };
    },
    async setDebugLogging(enabled: boolean) {
        if (typeof enabled !== 'boolean') throw new Error('setDebugLogging requires boolean enabled');
        await Editor.Profile.setConfig(packageJSON.name, 'debugLogging', enabled);
        const applied = utcpServer?.setDebugEnabled(enabled) ?? enabled;
        const method = applied ? 'startCatchAll' : 'stopCatchAll';
        Editor.Message.request('scene', 'execute-scene-script',
            { name: packageJSON.name, method, args: [] })
            .catch((err: any) => console.warn(`[cx3][scene] Scene console capture not toggled: ${err?.message || err}`));
        console.info(`[cx3][lifecycle] Verbose interaction logging ${applied ? 'ON' : 'OFF'}`);
        return { enabled: applied };
    },


    // The folder may not exist until debug logging is first enabled.
    openDebugFolder() {
        mkdirSync(DEBUG_LOG_DIR, { recursive: true });
        // ponytail: cross-platform open — works on Windows/macOS/Linux
        const cmd = process.platform === 'win32'
            ? `start "" "${DEBUG_LOG_DIR}"`
            : process.platform === 'darwin'
                ? `open "${DEBUG_LOG_DIR}"`
                : `xdg-open "${DEBUG_LOG_DIR}"`;
        return new Promise<void>((resolve, reject) => {
            exec(cmd, err => err ? reject(err) : resolve());
        });
    },

    clearDebugLogs() {
        try {
            const files = readdirSync(DEBUG_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
            files.forEach((f) => unlinkSync(join(DEBUG_LOG_DIR, f)));
            console.log(`[cx3][lifecycle] Cleared ${files.length} debug log file(s) from ${DEBUG_LOG_DIR}`);
        } catch (err: unknown) {
            if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') throw err;
        }
    },

};

export async function load() {
    return runLifecycle(async () => {
        console.log('[cx3][lifecycle] Loaded');
        console.log(`[cx3][lifecycle] build ${formatBuildInfo()}`);

        const configManager = getConfigManager();
        await configManager.initialize();
        const debugLogging = await Editor.Profile.getConfig(packageJSON.name, 'debugLogging') === true;
        const profileConfig = await configManager.getToolProfileConfig();
        const profile = profileConfig.profile;
        if (profile !== 'core' && profile !== 'full' && profile !== 'custom') throw new Error('Invalid tool profile.');
        setServerProfile(profile, profileConfig.enabled, profileConfig.disabled, profileConfig.envelope);

        try {
            const port = await configManager.getCurrentPort();
            const actualPort = await startPublishedServer(port, debugLogging);
            const url = `http://localhost:${actualPort}/utcp`;
            console.log(
                `[cx3][lifecycle] Ready: UTCP server listening at ${url}\n` +
                `[cx3][config] Code Mode config updated: ${configManager.getConfigPath()}\n` +
                `[cx3][lifecycle] New AI sessions discover ccb3x_${actualPort}; reconnect an existing Code Mode MCP session to refresh it.`
            );
        } catch (err) {
            console.error('[cx3][api] Failed to start UTCP Server:', err);
        }
    });
}

export async function unload() {
    return runLifecycle(async () => {
        cancelEditorAsk();
        cancelEditorPrompt();
        disposeEditorControl();
        await closeArtifactServers();
        const server = utcpServer;
        utcpServer = null;
        if (server) {
            console.log('[cx3][lifecycle] Stopping UTCP Server...');
            await stopPublishedServer(server);
        }
    });
}
