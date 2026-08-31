import { UtcpServerManager } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { formatBuildInfo, getBuildInfo } from './build-info';
import { exec } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readdirSync, unlinkSync } from 'fs';

const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');

const PKG_NAME = 'cc-bridge-2x';

let utcpServer: UtcpServerManager | null = null;

// Entry point 2.x: module.exports = { load, unload, messages }.
// Khac 3.x (export const methods + contributions.messages trong package.json).
// Doc: v2.4/extension/entry-point.md
module.exports = {
    async load() {
        Editor.log(`[${PKG_NAME}] build ${formatBuildInfo()}`);

        const configManager = getConfigManager();
        await configManager.initialize();

        utcpServer = new UtcpServerManager();

        // port 0 = xin OS mot free port bat ky
        const port = await configManager.getCurrentPort();
        try {
            const actualPort = await utcpServer.start(port);
            const url = `http://localhost:${actualPort}/utcp`;
            await configManager.updatePort(actualPort);
            Editor.log(
                `[${PKG_NAME}] Ready: UTCP server listening at ${url}\n` +
                `[${PKG_NAME}] Code Mode config updated: ${configManager.getConfigPath()}\n` +
                `[${PKG_NAME}] New AI sessions discover ccb2x automatically; reconnect an existing Code Mode MCP session to refresh it.`
            );
        } catch (err) {
            Editor.error(`[${PKG_NAME}] Failed to start UTCP Server: ${err}`);
        }
    },

    async unload() {
        if (utcpServer) {
            Editor.log(`[${PKG_NAME}] Stopping UTCP Server...`);
            await utcpServer.stop();
            utcpServer = null;
        }
    },

    // Short message (khong co ':') -> editor expand thanh 'cc-bridge-2x:restart-server'.
    // Goi tu renderer: Editor.Ipc.sendToPackage('cc-bridge-2x', 'restart-server', port).
    // Goi tu main-menu: click Extension -> CC Bridge 2x (khong co arg).
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
            // Menu click khong truyen port -> restart voi port hien tai (0 = auto)
            if (typeof newPort !== 'number' || !newPort) {
                newPort = await getConfigManager().getCurrentPort();
            }
            const previousServer = utcpServer;
            try {
                await previousServer.stop();
                const nextServer = new UtcpServerManager();
                const actualPort = await nextServer.start(newPort);
                utcpServer = nextServer;
                Editor.log(`[${PKG_NAME}] UTCP Server restarted on port ${actualPort}`);
                await getConfigManager().updatePort(actualPort);
            } catch (err: unknown) {
                utcpServer = null;
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
            const portP = cm.getCurrentPort().catch(() => 0);
            // fire-and-log without blocking dialog; port resolves fast (profile read)
            portP.then((port: number) => {
                const configPath = cm.getConfigPath();
                const url = port ? `http://localhost:${port}/utcp` : '(not running)';
                const lines = [
                    `Port:     ${port || '(not running)'} | Config: ${configPath} | ${url}`,
                    `Version:  ${b.version}`,
                    `Commit:   ${b.commit}${b.dirty ? '-dirty' : ''}`,
                    `Branch:   ${b.branch}`,
                    `Built at: ${b.builtAt}`,
                ];
                Editor.log(`[${PKG_NAME}] Build info:\n${lines.join('\n')}`);
                try {
                    (Editor as any).Dialog.messageBox({
                        type: 'info',
                        title: `${PKG_NAME} Build Info`,
                        message: lines.join('\n'),
                        buttons: ['OK'],
                        defaultId: 0,
                    });
                } catch {
                    try {
                        (Editor as any).Dialog.info(lines.join('\n'), { title: `${PKG_NAME} Build Info` });
                    } catch { /* logged above */ }
                }
            });
        },
        'open-config'() {
            Editor.Panel.open(PKG_NAME);
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
