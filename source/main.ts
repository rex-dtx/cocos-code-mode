import packageJSON from '../package.json';
import { UtcpServerManager } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo } from './build-info';
import { exec } from 'child_process';

let utcpServer: UtcpServerManager | null = null;


export const methods: { [key: string]: (...any: any) => any } = {

    openPanel() {
        Editor.Panel.open(packageJSON.name + '.configuration');
    },

    openPreviewPanel() {
        Editor.Panel.open(packageJSON.name + '.preview');
    },


    async restartServer(newPort: number) {
        if (utcpServer) {
            console.log(`[${packageJSON.name}] Restarting UTCP Server on port ${newPort}...`);
            utcpServer.stop();
            try {
                const actualPort = await utcpServer.start(newPort);
                console.log(`[${packageJSON.name}] UTCP Server restarted on port ${actualPort}`);

                // Используем менеджер конфигурации для обновления порта
                const configManager = getConfigManager();
                await configManager.updatePort(actualPort);
            } catch (err) {
                console.error(`[${packageJSON.name}] Failed to restart UTCP Server:`, err);
            }
        }
    },

    toggleDebug() {
        if (!utcpServer) return;
        const enabled = utcpServer.toggleDebug();
        const status = enabled ? 'ON' : 'OFF';
        console.log(`[${packageJSON.name}] Debug logging ${status}`);
        // ponytail: toast notification via Editor.Dialog is heavy; console.log is enough for a dev toggle
    },

    openDebugLogs() {
        if (!utcpServer) return;
        const logFile = utcpServer.getDebugLogFile();
        if (!logFile) {
            console.warn(`[${packageJSON.name}] No debug log file found. Enable debug first.`);
            return;
        }
        // ponytail: cross-platform open — works on Windows/macOS/Linux
        const cmd = process.platform === 'win32'
            ? `start "" "${logFile}"`
            : process.platform === 'darwin'
                ? `open "${logFile}"`
                : `xdg-open "${logFile}"`;
        exec(cmd, (err) => {
            if (err) console.error(`[${packageJSON.name}] Failed to open log file:`, err.message);
        });
    }
};

export async function load() {
    // Log provenance before anything else: if the editor is running a stale dist/,
    // this is the line that says so.
    console.log(`[${packageJSON.name}] build ${formatBuildInfo()}`);

    // Initialize config manager
    const configManager = getConfigManager();
    await configManager.initialize();
    
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
        utcpServer.stop();
        utcpServer = null;
    }
}
