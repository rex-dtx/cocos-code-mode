import packageJSON from '../package.json';
import { UtcpServerManager, setServerProfile } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { ProtectedRelayHost } from './protected/relay-host';
import { BOOT_LOG_PATH, bootLog, bootWarnDialog } from './protected/boot-log';

let utcpServer: UtcpServerManager | null = null;
let relayHost: ProtectedRelayHost | null = null;

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
            const nextServer = new UtcpServerManager(relayHost ?? undefined);
            const actualPort = await nextServer.start(newPort);
            utcpServer = nextServer;
            await getConfigManager().updatePort(actualPort);
            console.log(`[${packageJSON.name}] UTCP Server restarted on port ${actualPort}`);
        } catch (err) {
            utcpServer = null;
            console.error(`[${packageJSON.name}] Failed to restart UTCP Server:`, err);
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
            `    Boot log: ${BOOT_LOG_PATH}`,
        ];
        console.log(lines.join('\n'));
    }
};

export async function load() {
    bootLog("info", `Loaded ${formatBuildInfo()}`);
    try {
        const configManager = getConfigManager();
        await configManager.initialize();
        const profileConfig = await configManager.getToolProfileConfig();
        setServerProfile(profileConfig.profile as any, profileConfig.enabled, profileConfig.disabled, profileConfig.envelope);

        try {
            relayHost = new ProtectedRelayHost();
            relayHost.activateIfConfigured();
            bootLog("info", `relay identity=${relayHost.identity.deviceKeyId}`);
        } catch (err) {
            relayHost = null;
            bootLog("error", "Protected relay failed to boot; menus and local tools still start", err);
        }
        if (process.env.CCB_DISABLE_LOCAL_UTCP === "1") {
            bootLog("info", "Local broker disabled by CCB_DISABLE_LOCAL_UTCP=1");
            return;
        }
        utcpServer = new UtcpServerManager(relayHost ?? undefined);
        let wasConfiguredPort = true;
        let port = await Editor.Profile.getConfig(packageJSON.name, "serverPort");
        if (typeof port !== "number") {
            port = 0;
            wasConfiguredPort = false;
        }
        try {
            const actualPort = await utcpServer.start(port);
            const url = `http://localhost:${actualPort}/utcp`;
            await configManager.updatePort(actualPort);
            bootLog("info", `UTCP listening at ${url}; boot log ${BOOT_LOG_PATH}`);
        } catch (err) {
            bootWarnDialog(`UTCP failed to start. See ${BOOT_LOG_PATH}`);
            bootLog("error", "Failed to start UTCP Server", err);
        }
        if (!wasConfiguredPort) {
            Editor.Panel.open(packageJSON.name + ".configuration");
        }
    } catch (err) {
        bootWarnDialog(`Extension load failed. See ${BOOT_LOG_PATH}`);
        bootLog("error", "Extension load failed; menu handlers remain registered", err);
    }
}

export function unload() {
    if (relayHost) {
        void relayHost.state.drain(5_000);
        relayHost.close();
        relayHost = null;
    }
    if (utcpServer) {
        console.log(`[${packageJSON.name}] Stopping UTCP Server...`);
        const port = (utcpServer as any).port ?? 0;
        utcpServer.stop();
        utcpServer = null;
        getConfigManager().removeCocosEditorTemplate(port).catch(() => {});
    }
}
