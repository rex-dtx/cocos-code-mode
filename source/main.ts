import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import packageJSON from '../package.json';
import { UtcpServerManager, setServerProfile } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { ProtectedRelayHost } from './protected/relay-host';
import { BOOT_LOG_PATH, bootLog, bootWarnDialog } from './protected/boot-log';
import { toCcbErrorBody } from './protected/errors';
import { launchPendingHealthRollback, launchStagedActivation } from './update/activation';
import { UpdateManager, type StagedUpdate } from './update/manager';
import { UpdateStateStore } from './update/state';

let utcpServer: UtcpServerManager | null = null;
let relayHost: ProtectedRelayHost | null = null;
let updateManager: UpdateManager | null = null;
let stagedUpdate: StagedUpdate | null = null;
const extensionRoot = resolve(__dirname, '..');
const activationHelperPath = join(extensionRoot, 'scripts', 'install-update.ps1');
let pendingHealthRollback = false;

function finishPendingHealth(healthy: boolean): void {
    const backup = `${extensionRoot}.prev`;
    if (!existsSync(backup)) return;
    const state = new UpdateStateStore();
    try {
        if (!healthy) {
            state.markRollbackRequired();
            pendingHealthRollback = true;
            bootLog('error', 'Signed update failed startup health; rollback queued for Creator shutdown');
            return;
        }
        state.markHealthy();
        rmSync(backup, { recursive: true, force: true });
        bootLog('info', 'Signed update passed startup health; prior package removed');
    } catch (error) {
        bootLog('error', `Unable to resolve pending update health: ${toCcbErrorBody(error).code}`);
    }
}

function stageUpdateInBackground(): void {
    if (!updateManager) return;
    if (existsSync(`${extensionRoot}.prev`)) return;
    void updateManager.checkAndStage().then((result) => {
        stagedUpdate = result;
        bootLog('info', `Signed update staged: ${result.accepted.target.package.version}`);
    }).catch((error) => {
        bootLog('error', `Background update check failed: ${toCcbErrorBody(error).code}`);
    });
}

export const methods: Record<string, Function> = {

    openPanel() {
        Editor.Panel.open(packageJSON.name + '.configuration');
    },

    openPreviewPanel() {
        Editor.Panel.open(packageJSON.name + '.preview');
    },

    async showInfo() {
        return methods.showBuildInfo();
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
    },
    async checkForUpdates() {
        if (!updateManager) return { staged: false, reason: 'Signed updates are not configured.' };
        try {
            const result = await updateManager.checkAndStage();
            stagedUpdate = result;
            return { staged: true, version: result.accepted.target.package.version };
        } catch (error) {
            const body = toCcbErrorBody(error);
            bootLog('error', `Update check failed: ${body.code}`);
            return { staged: false, ...body };
        }
    }
};

export async function load() {
    bootLog("info", `Loaded ${formatBuildInfo()}`);
    try {
        const configManager = getConfigManager();
        await configManager.initialize();
        const profileConfig = await configManager.getToolProfileConfig();
        const profile = profileConfig.profile === 'core' || profileConfig.profile === 'full' ? profileConfig.profile : 'full';
        setServerProfile(profile, profileConfig.enabled, profileConfig.disabled, profileConfig.envelope);

        try {
            relayHost = new ProtectedRelayHost();
            relayHost.activateIfConfigured();
            bootLog("info", `relay identity=${relayHost.identity.deviceKeyId}`);
        } catch (err) {
            relayHost = null;
            bootLog("error", "Protected relay failed to boot; menus and local tools still start", err);
        }
        const releaseOrigin = process.env.CCB_RELEASE_ORIGIN;
        if (releaseOrigin && relayHost) {
            const configuredRing = process.env.CCB_RELEASE_RING;
            const allowedRing = configuredRing === '3' || configuredRing === '10' ? configuredRing : '1';
            const build = getBuildInfo();
            updateManager = new UpdateManager({
                origin: releaseOrigin,
                compatibility: {
                    protocolVersion: 1,
                    creatorVersion: packageJSON.creator.version,
                    os: process.platform,
                    arch: process.arch,
                    currentBuild: `${build.version}-dev.${build.commit}`,
                    deviceId: relayHost.identity.deviceId,
                    channel: process.env.CCB_RELEASE_CHANNEL || 'stable',
                    allowedRing,
                },
            });
        }
        if (process.env.CCB_DISABLE_LOCAL_UTCP === "1") {
            bootLog("info", "Local broker disabled by CCB_DISABLE_LOCAL_UTCP=1");
            stageUpdateInBackground();
            finishPendingHealth(relayHost !== null);
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
            stageUpdateInBackground();
            finishPendingHealth(relayHost !== null);
        } catch (err) {
            bootWarnDialog(`UTCP failed to start. See ${BOOT_LOG_PATH}`);
            bootLog("error", "Failed to start UTCP Server", err);
            finishPendingHealth(false);
        }
        if (!wasConfiguredPort) {
            Editor.Panel.open(packageJSON.name + ".configuration");
        }
    } catch (err) {
        bootWarnDialog(`Extension load failed. See ${BOOT_LOG_PATH}`);
        bootLog("error", "Extension load failed; menu handlers remain registered", err);
        finishPendingHealth(false);
    }
}

export function unload() {
    if (pendingHealthRollback) {
        try {
            launchPendingHealthRollback({
                creatorPid: process.pid,
                creatorExecutablePath: process.execPath,
                liveDirectory: extensionRoot,
                helperPath: activationHelperPath,
            });
        } catch (error) {
            bootLog('error', `Unable to queue pending-health rollback: ${toCcbErrorBody(error).code}`);
        }
    } else if (stagedUpdate && updateManager) {
        try {
            updateManager.markActivationQueued();
            launchStagedActivation({
                creatorPid: process.pid,
                creatorExecutablePath: process.execPath,
                stagedDirectory: stagedUpdate.stagedDirectory,
                liveDirectory: extensionRoot,
                descriptorSha256: stagedUpdate.descriptorSha256,
                helperPath: activationHelperPath,
            });
            bootLog('info', `Signed update queued for Creator shutdown: ${stagedUpdate.accepted.target.package.version}`);
        } catch (error) {
            bootLog('error', `Unable to queue staged update: ${toCcbErrorBody(error).code}`);
        }
    }
    pendingHealthRollback = false;
    stagedUpdate = null;
    updateManager = null;
    if (relayHost) {
        void relayHost.state.drain(5_000);
        relayHost.close();
        relayHost = null;
    }
    if (utcpServer) {
        console.log(`[${packageJSON.name}] Stopping UTCP Server...`);
        const port = utcpServer.port;
        utcpServer.stop();
        utcpServer = null;
        getConfigManager().removeCocosEditorTemplate(port).catch(() => {});
    }
}
