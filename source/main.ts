import packageJSON from '../package.json';
import { UtcpServerManager, setServerProfile } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';

let utcpServer: UtcpServerManager | null = null;
const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');


export const methods: { [key: string]: (...any: any) => any } = {

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
        if (!utcpServer) {
            console.warn(`[${packageJSON.name}] UTCP Server is not running.`);
            return;
        }
        if (typeof newPort !== 'number' || !newPort) {
            newPort = await getConfigManager().getCurrentPort().catch(() => 0);
        }

        const previousServer = utcpServer;
        try {
            await previousServer.stop();
            const nextServer = new UtcpServerManager();
            const actualPort = await nextServer.start(newPort);
            utcpServer = nextServer;
            await getConfigManager().updatePort(actualPort);
            console.log(`[${packageJSON.name}] UTCP Server restarted on port ${actualPort}`);
        } catch (err) {
            utcpServer = null;
            console.error(`[${packageJSON.name}] Failed to restart UTCP Server:`, err);
        }
    },


    toggleDebug() {
        if (!utcpServer) return;
        const enabled = utcpServer.toggleDebug();
        const status = enabled ? 'ON' : 'OFF';
        console.log(`[${packageJSON.name}] Debug logging ${status}`);
        // Also toggle scene-process console capture (log/warn/error from editor
        // scripts). Fails silently when no scene is open — MCP logging still works.
        const method = enabled ? 'startCatchAll' : 'stopCatchAll';
        Editor.Message.request('scene', 'execute-scene-script',
            { name: packageJSON.name, method, args: [] })
            .catch((err: any) => console.warn(`[${packageJSON.name}] Scene console capture not toggled: ${err?.message || err}`));
    },

    // The folder may not exist until debug logging is first enabled.
    openDebugFolder() {
        try {
            mkdirSync(DEBUG_LOG_DIR, { recursive: true });
        } catch (err: unknown) {
            console.error(`[${packageJSON.name}] Failed to create debug folder:`, err instanceof Error ? err.message : String(err));
            return;
        }
        // ponytail: cross-platform open — works on Windows/macOS/Linux
        const cmd = process.platform === 'win32'
            ? `start "" "${DEBUG_LOG_DIR}"`
            : process.platform === 'darwin'
                ? `open "${DEBUG_LOG_DIR}"`
                : `xdg-open "${DEBUG_LOG_DIR}"`;
        exec(cmd, (err) => {
            if (err) console.error(`[${packageJSON.name}] Failed to open debug folder:`, err.message);
        });
    },

    clearDebugLogs() {
        try {
            const files = readdirSync(DEBUG_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
            files.forEach((f) => unlinkSync(join(DEBUG_LOG_DIR, f)));
            console.log(`[${packageJSON.name}] Cleared ${files.length} debug log file(s) from ${DEBUG_LOG_DIR}`);
        } catch (err: any) {
            // ENOENT means the folder never existed — nothing to clear.
            if (err?.code !== 'ENOENT') {
                console.error(`[${packageJSON.name}] Failed to clear debug logs:`, err?.message || err);
            }
        }
    },

    async showBuildInfo() {
        const b = getBuildInfo();
        const cm = getConfigManager();
        // ponytail: merged Server Info + About — single log has port/config/url + build info (same as 2x)
        const port = await cm.getCurrentPort().catch(() => 0);
        const configPath = cm.getConfigPath();
        const url = port ? `http://localhost:${port}/utcp` : '(not running)';
        const lines = [
            `Port:     ${port || '(not running)'} | Config: ${configPath} | ${url}`,
            `Version:  ${b.version}`,
            `Commit:   ${b.commit}${b.dirty ? '-dirty' : ''}`,
            `Branch:   ${b.branch}`,
            `Built at: ${b.builtAt}`,
        ];
        console.log(`[${packageJSON.name}] Build info:\n${lines.join('\n')}`);
    }
};

export async function load() {
    // Log provenance before anything else: if the editor is running a stale dist/,
    // this is the line that says so.
    console.log(`[${packageJSON.name}] build ${formatBuildInfo()}`);

    // Initialize config manager
    const configManager = getConfigManager();
    await configManager.initialize();

    // Load and apply tool profile config
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

    try {
        const actualPort = await utcpServer.start(port);
        console.log(`[${packageJSON.name}] UTCP Server started on port ${actualPort}`);

        // Automatically update the port in the configuration on startup
        await configManager.updatePort(actualPort);
        console.log(`[${packageJSON.name}] UTCP config automatically updated with port ${actualPort}`);
    } catch (err) {
        console.error(`[${packageJSON.name}] Failed to start UTCP Server:`, err);
    }

    if (!wasConfiguredPort) {
        Editor.Panel.open(packageJSON.name);
    }
}

export function unload() {
    if (utcpServer) {
        console.log(`[${packageJSON.name}] Stopping UTCP Server...`);
        const port = (utcpServer as any).port ?? 0;
        utcpServer.stop();
        utcpServer = null;
        // Best-effort: don't block unload on config I/O.
        getConfigManager().removeCocosEditorTemplate(port).catch(() => {});
    }
}
