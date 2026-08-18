import { UtcpServerManager } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';

const PKG_NAME = 'cocos-code-mode-2x';

let utcpServer: UtcpServerManager | null = null;

// Entry point 2.x: module.exports = { load, unload, messages }.
// Khac 3.x (export const methods + contributions.messages trong package.json).
// Doc: v2.4/extension/entry-point.md
module.exports = {
    async load() {
        const configManager = getConfigManager();
        await configManager.initialize();

        utcpServer = new UtcpServerManager();

        // port 0 = xin OS mot free port bat ky
        const port = await configManager.getCurrentPort();
        try {
            const actualPort = await utcpServer.start(port);
            Editor.log(`[${PKG_NAME}] UTCP Server started on port ${actualPort}`);
            await configManager.updatePort(actualPort);
        } catch (err) {
            Editor.error(`[${PKG_NAME}] Failed to start UTCP Server: ${err}`);
        }
    },

    unload() {
        if (utcpServer) {
            Editor.log(`[${PKG_NAME}] Stopping UTCP Server...`);
            utcpServer.stop();
            utcpServer = null;
        }
    },

    // Short message (khong co ':') -> editor expand thanh 'cocos-code-mode-2x:restart-server'.
    // Goi tu renderer: Editor.Ipc.sendToPackage('cocos-code-mode-2x', 'restart-server', port).
    // Goi tu main-menu: click Extension -> Cocos Code Mode 2x (khong co arg).
    messages: {
        'show-info'() {
            const cm = getConfigManager();
            // port from profile (last saved) — server does not keep it as a field
            cm.getCurrentPort().then((port) => {
                const configPath = cm.getConfigPath();
                const url = port ? `http://localhost:${port}/utcp` : '(not running)';
                Editor.log(`[${PKG_NAME}] port=${port} | config=${configPath} | ${url}`);
            });
        },
        async 'restart-server'(event: any, newPort: number) {
            if (!utcpServer) {
                return;
            }
            // Menu click khong truyen port -> restart voi port hien tai (0 = auto)
            if (typeof newPort !== 'number' || !newPort) {
                newPort = await getConfigManager().getCurrentPort();
            }
            utcpServer.stop();
            try {
                const actualPort = await utcpServer.start(newPort);
                Editor.log(`[${PKG_NAME}] UTCP Server restarted on port ${actualPort}`);
                await getConfigManager().updatePort(actualPort);
            } catch (err) {
                Editor.error(`[${PKG_NAME}] Failed to restart UTCP Server: ${err}`);
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
        }
    }
};
