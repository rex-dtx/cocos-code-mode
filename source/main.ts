import packageJSON from '../package.json';
import { UtcpServerManager, setServerProfile } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';
import { cancelEditorAsk } from './utcp/editor-ask';
import { cancelEditorPrompt, getEditorPrompt, respondEditorPrompt } from './utcp/editor-prompt';
import { cancelEditorTask, disposeEditorControl, getEditorControl } from './utcp/editor-control-plane';

let utcpServer: UtcpServerManager | null = null;
const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');


export const methods: { [key: string]: (...any: any) => any } = {
    getEditorPrompt,
    respondEditorPrompt,
    getEditorControl,
    cancelEditorTask,
    openAgentInbox() {
        return Editor.Panel.open(`${packageJSON.name}.prompt`);
    },

    openPanel() {
        Editor.Panel.open(packageJSON.name + '.configuration');
    },

    openPreviewPanel() {
        Editor.Panel.open(packageJSON.name + '.preview');
    },

    async showInfo() {
        // ponytail: alias kept for compat, menu no longer exposes it — delegates to show-build-info
        return (methods as any).showBuildInfo();
    },

    async restartServer(newPort?: number) {
        cancelEditorAsk();
        cancelEditorPrompt();
        if (!utcpServer) {
            console.warn('[cx3] UTCP Server is not running.');
            return;
        }
        if (typeof newPort !== 'number' || !newPort) {
            newPort = await getConfigManager().getCurrentPort().catch(() => 0);
        }

        const previousServer = utcpServer;
        try {
            await previousServer.stop();
            const nextServer = new UtcpServerManager();
            nextServer.setDebugEnabled(previousServer.getDebugEnabled());
            const actualPort = await nextServer.start(newPort);
            utcpServer = nextServer;
            await getConfigManager().updatePort(actualPort);
            console.log(`[cx3] UTCP Server restarted on port ${actualPort}`);
        } catch (err) {
            utcpServer = null;
            console.error('[cx3] Failed to restart UTCP Server:', err);
        }
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
            .catch((err: any) => console.warn(`[cx3] Scene console capture not toggled: ${err?.message || err}`));
        console.info(`[cx3] Verbose interaction logging ${applied ? 'ON' : 'OFF'}`);
        return { enabled: applied };
    },

    async toggleDebug() {
        const current = utcpServer?.getDebugEnabled() ?? Boolean(await Editor.Profile.getConfig(packageJSON.name, 'debugLogging'));
        return (methods as any).setDebugLogging(!current);
    },

    // The folder may not exist until debug logging is first enabled.
    openDebugFolder() {
        try {
            mkdirSync(DEBUG_LOG_DIR, { recursive: true });
        } catch (err: unknown) {
            console.error('[cx3] Failed to create debug folder:', err instanceof Error ? err.message : String(err));
            return;
        }
        // ponytail: cross-platform open — works on Windows/macOS/Linux
        const cmd = process.platform === 'win32'
            ? `start "" "${DEBUG_LOG_DIR}"`
            : process.platform === 'darwin'
                ? `open "${DEBUG_LOG_DIR}"`
                : `xdg-open "${DEBUG_LOG_DIR}"`;
        exec(cmd, (err) => {
            if (err) console.error('[cx3] Failed to open debug folder:', err.message);
        });
    },

    clearDebugLogs() {
        try {
            const files = readdirSync(DEBUG_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
            files.forEach((f) => unlinkSync(join(DEBUG_LOG_DIR, f)));
            console.log(`[cx3] Cleared ${files.length} debug log file(s) from ${DEBUG_LOG_DIR}`);
        } catch (err: any) {
            // ENOENT means the folder never existed — nothing to clear.
            if (err?.code !== 'ENOENT') {
                console.error('[cx3] Failed to clear debug logs:', err?.message || err);
            }
        }
    },

    async showBuildInfo() {
        const b = getBuildInfo();
        const cm = getConfigManager();
        // ponytail: merged Server Info + About — single log has port/config/url + build info (same as 2x)
        const port = await cm.getCurrentPort().catch(() => 0);
        const configPath = cm.getConfigPath();
        const isRunning = Boolean(port && utcpServer);
        const statusIcon = isRunning ? '🟢' : '🔴';
        const statusUrl = isRunning ? `http://localhost:${port}/utcp` : 'Server not running';
        const commitStr = `${b.commit}${b.dirty ? '-dirty' : ''}`;
        const versionTag = `v${b.version}@${commitStr}`;

        const lines = [
            `[${packageJSON.name}] ${statusIcon} ${statusUrl} (${versionTag})`,
            `  Build info:`,
            `    Port:     ${port || '(not running)'}`,
            `    Config:   ${configPath}`,
            `    Branch:   ${b.branch}`,
            `    Built at: ${b.builtAt}`,
        ];
        console.log(lines.join('\n'));
    }
};

export async function load() {
    console.log('[cx3] Loaded');
    console.log(`[cx3] build ${formatBuildInfo()}`);

    // Initialize config manager
    const configManager = getConfigManager();
    await configManager.initialize();

    // Load and apply tool profile config
    const persistedDebugLogging = await Editor.Profile.getConfig(packageJSON.name, 'debugLogging');
    const debugLogging = persistedDebugLogging === true;
    const profileConfig = await configManager.getToolProfileConfig();
    setServerProfile(profileConfig.profile as any, profileConfig.enabled, profileConfig.disabled, profileConfig.envelope);

    utcpServer = new UtcpServerManager();

    let wasConfiguredPort = true;
    // Load port from profile, default to 0 (random free port) if not set
    let port = await Editor.Profile.getConfig(packageJSON.name, 'serverPort');
    if (typeof port !== 'number') {
        port = 0;
        wasConfiguredPort = false;
    }
    utcpServer.setDebugEnabled(debugLogging);

    try {
        const actualPort = await utcpServer.start(port);
        const url = `http://localhost:${actualPort}/utcp`;
        await configManager.updatePort(actualPort);
        console.log(
            `[cx3] Ready: UTCP server listening at ${url}\n` +
            `[cx3] Code Mode config updated: ${configManager.getConfigPath()}\n` +
            '[cx3] New AI sessions discover ccb3x automatically; reconnect an existing Code Mode MCP session to refresh it.'
        );
    } catch (err) {
        console.error('[cx3] Failed to start UTCP Server:', err);
    }

    if (!wasConfiguredPort) {
        Editor.Panel.open(packageJSON.name);
    }
}

export function unload() {
    cancelEditorAsk();
    cancelEditorPrompt();
    disposeEditorControl();
    if (utcpServer) {
        console.log('[cx3] Stopping UTCP Server...');
        const port = (utcpServer as any).port ?? 0;
        utcpServer.stop();
        utcpServer = null;
        // Best-effort: don't block unload on config I/O.
        getConfigManager().removeCocosEditorTemplate(port).catch(() => {});
    }
}
