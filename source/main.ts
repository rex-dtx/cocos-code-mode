import { UtcpServerManager } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';

const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');

const PKG_NAME = 'cocos-pilot-2x';

let utcpServer: UtcpServerManager | null = null;
const registryPaths = new WeakMap<UtcpServerManager, string>();
async function stopPublishedServer(server: UtcpServerManager): Promise<void> {
    const { port, instanceId } = server;
    try { await server.stop(); }
    finally {
        if (port && registryPaths.has(server)) {
            await getConfigManager().removeCocosEditorTemplate(port, instanceId, registryPaths.get(server));
        }
    }
}

// Entry point 2.x: module.exports = { load, unload, messages }.
// Khac 3.x (export const methods + contributions.messages trong package.json).
// Doc: v2.4/extension/entry-point.md
module.exports = {
    async load() {
        Editor.log(`[${PKG_NAME}] build ${formatBuildInfo()}`);

        const configManager = getConfigManager();
        await configManager.initialize();

        let server = new UtcpServerManager();
        try {
            // Port preferences are shared by editors of the same project; an existing registry
            // owner/legacy alias is not this fresh process, even if its endpoint is now closed.
            if (typeof Editor.Project?.path !== 'string' || !Editor.Project.path) {
                throw new Error('Editor.Project.path unavailable; refusing to publish an unbound endpoint.');
            }
            const savedPort = await configManager.getCurrentPort();
            const registry = configManager.readConfig();
            const reserved = savedPort > 0 && (Boolean(registry.variables?.[`CCP2X_OWNER_${savedPort}`]
                || registry.variables?.[`CCP2X_PROJECT_${savedPort}`]
                || registry.variables?.[`CCB2X_OWNER_${savedPort}`]
                || registry.variables?.[`CCB2X_PROJECT_${savedPort}`])
                || registry.manual_call_templates?.some((entry: { name: string; url?: string }) =>
                    entry.name === `ccp2x_${savedPort}` || entry.name === `ccb2x_${savedPort}`
                    || (['ccb2x', 'cc-bridge-2x', 'ccb-2x', 'ccb_2x', 'cc_bridge_2x'].includes(entry.name)
                        && (entry.url === `http://localhost:${savedPort}/utcp` || entry.url === `http://127.0.0.1:${savedPort}/utcp`))));
            let actualPort: number;
            try { actualPort = await server.start(reserved ? 0 : savedPort); }
            catch (error: unknown) {
                if (savedPort === 0 || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
                server = new UtcpServerManager();
                actualPort = await server.start(0);
            }
            registryPaths.set(server, configManager.getConfigPath());
            await configManager.updatePort(actualPort, server.instanceId, Editor.Project.path);
            utcpServer = server;
            Editor.log(`[${PKG_NAME}] Ready: http://localhost:${actualPort}/utcp; namespace ccp2x_${actualPort}; project ${Editor.Project.path}; instance ${server.instanceId}. Re-handshake after reconnect or restart.`);
        } catch (err) {
            await stopPublishedServer(server).catch((cleanupError: unknown) => Editor.warn(`[${PKG_NAME}] Startup cleanup failed: ${cleanupError}`));
            Editor.error(`[${PKG_NAME}] Failed to start UTCP Server: ${err}`);
        }
    },

    async unload() {
        if (utcpServer) {
            const server = utcpServer;
            utcpServer = null;
            Editor.log(`[${PKG_NAME}] Stopping UTCP Server...`);
            await stopPublishedServer(server);
        }
    },

    // Short messages expand to the current package's message namespace.
    // Renderer: Editor.Ipc.sendToPackage('cocos-pilot-2x', 'restart-server', port).
    // Main menu: Extension -> Cocos Pilot 2x (no port argument).
    messages: {
        'show-info'() {
            // ponytail: alias kept for compat, menu no longer exposes it — delegates to show-build-info
            (module.exports as any).messages['show-build-info']();
        },
        async 'restart-server'(_event: unknown, newPort: number) {
            if (!utcpServer) {
                Editor.warn(`[${PKG_NAME}] UTCP Server is not running.`);
                return;
            }
            const previousServer = utcpServer;
            // Menu click khong truyen port -> restart voi port hien tai (0 = auto)
            if (typeof newPort !== 'number' || !newPort) {
                newPort = previousServer.port;
            }
            utcpServer = null;
            try {
                await stopPublishedServer(previousServer);
                const nextServer = new UtcpServerManager();
                try {
                    if (newPort !== previousServer.port && newPort > 0) {
                        const registry = getConfigManager().readConfig();
                        if (registry.variables?.[`CCP2X_OWNER_${newPort}`]
                            || registry.variables?.[`CCP2X_PROJECT_${newPort}`]
                            || registry.variables?.[`CCB2X_OWNER_${newPort}`]
                            || registry.variables?.[`CCB2X_PROJECT_${newPort}`]
                            || registry.manual_call_templates?.some((entry: { name: string; url?: string }) =>
                                entry.name === `ccp2x_${newPort}` || entry.name === `ccb2x_${newPort}`
                                || (['ccb2x', 'cc-bridge-2x', 'ccb-2x', 'ccb_2x', 'cc_bridge_2x'].includes(entry.name)
                                    && (entry.url === `http://localhost:${newPort}/utcp` || entry.url === `http://127.0.0.1:${newPort}/utcp`)))) {
                            throw new Error(`Port ${newPort} belongs to another registry owner.`);
                        }
                    }
                    if (typeof Editor.Project?.path !== 'string' || !Editor.Project.path) {
                        throw new Error('Editor.Project.path unavailable; refusing to publish an unbound endpoint.');
                    }
                    const actualPort = await nextServer.start(newPort);
                    const config = getConfigManager();
                    registryPaths.set(nextServer, config.getConfigPath());
                    await config.updatePort(actualPort, nextServer.instanceId, Editor.Project.path);
                    utcpServer = nextServer;
                    Editor.log(`[${PKG_NAME}] UTCP Server restarted: ccp2x_${actualPort}, instance ${nextServer.instanceId}. Re-handshake before mutations.`);
                } catch (error) {
                    await stopPublishedServer(nextServer);
                    throw error;
                }
            } catch (err: unknown) {
                Editor.error(`[${PKG_NAME}] Failed to restart UTCP Server: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
        'reload'() {
            // 2.4 reload = unload + load. Editor tu reload package khi file doi,
            // nhung junction khong trigger watcher -> can goi tay.
            // Pomelo: (Editor as any).Package.reload khong on dinh giua cac ban 2.4,
            // nen dung Ipc reload-package neu co, fallback la log huong dan.
            try {
                const pkg = (Editor as any).Package;
                if (pkg && typeof pkg.reload === 'function') {
                    pkg.reload(PKG_NAME);
                    Editor.log(`[${PKG_NAME}] Reloading...`);
                    return;
                }
            } catch (e) { /* fallback */ }
            Editor.Ipc.sendToMain('package:reload', PKG_NAME, (err: any) => {
                if (err) {
                    Editor.warn(`[${PKG_NAME}] Auto-reload not available, please restart Creator (Ctrl+R or reopen project).`);
                } else {
                    Editor.log(`[${PKG_NAME}] Reloading...`);
                }
            });
        },
        'show-build-info'() {
            const b = getBuildInfo();
            const cm = getConfigManager();
            // ponytail: merged Server Info + About — single log has port/config/url + build info
            const port = utcpServer?.port ?? 0;
            const configPath = cm.getConfigPath();
            const statusUrl = port ? `http://localhost:${port}/utcp` : 'Server not running';
            const commitStr = `${b.commit}${b.dirty ? '-dirty' : ''}`;
            Editor.log([
                `[${PKG_NAME}] ${statusUrl} (v${b.version}@${commitStr})`,
                `  Namespace: ${port ? `ccp2x_${port}` : '(not running)'}`,
                `  Instance:  ${utcpServer?.instanceId ?? '(not running)'}`,
                `  Project:   ${Editor.Project.path}`,
                `  Config:    ${configPath}`,
                `  Branch:    ${b.branch}`,
                `  Built at:  ${b.builtAt}`,
            ].join('\n'));
        },
        'open-config'() {
            Editor.Panel.open(PKG_NAME);
        },
        async 'query-status'(event: unknown) {
            const cm = getConfigManager();
            const port = utcpServer?.port ?? 0;
            const configPath = cm.getConfigPath();
            const payload = {
                port, configPath,
                url: port ? `http://localhost:${port}/utcp` : '',
                namespace: port ? `ccp2x_${port}` : null,
                instanceId: utcpServer?.instanceId ?? null,
                projectPath: Editor.Project.path || null,
                running: port > 0,
            };
            const ev = event as { reply?: (err: unknown, data?: unknown) => void };
            if (ev && typeof ev.reply === 'function') ev.reply(null, payload);
        },
        'toggle-debug'() {
            if (!utcpServer) return;
            const enabled = utcpServer.toggleDebug();
            const status = enabled ? 'ON' : 'OFF';
            Editor.log(`[${PKG_NAME}] Debug logging ${status}`);
            const method = enabled ? 'startCatchAll' : 'stopCatchAll';
            Editor.Scene.callSceneScript(PKG_NAME, method, (err: any) => {
                if (err) Editor.log(`[${PKG_NAME}] Scene console capture not toggled: ${err.message || err}`);
            });
        },
        'open-debug-folder'() {
            try {
                mkdirSync(DEBUG_LOG_DIR, { recursive: true });
            } catch (err: unknown) {
                Editor.error(`[${PKG_NAME}] Failed to create debug folder: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
            const cmd = process.platform === 'win32' ? `start "" "${DEBUG_LOG_DIR}"` : process.platform === 'darwin' ? `open "${DEBUG_LOG_DIR}"` : `xdg-open "${DEBUG_LOG_DIR}"`;
            exec(cmd, (err) => { if (err) Editor.error(`[${PKG_NAME}] Failed to open debug folder: ${err.message}`); });
        },
        'clear-debug-logs'() {
            try {
                const files = readdirSync(DEBUG_LOG_DIR).filter((f) => f.endsWith('.jsonl'));
                files.forEach((f) => unlinkSync(join(DEBUG_LOG_DIR, f)));
                Editor.log(`[${PKG_NAME}] Cleared ${files.length} debug log file(s) from ${DEBUG_LOG_DIR}`);
            } catch (err: any) { if (err?.code !== 'ENOENT') Editor.error(`[${PKG_NAME}] Failed to clear debug logs: ${err.message || err}`); }
        }
    }
};
