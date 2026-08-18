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

    // Short message (khong co ':') -> editor expand thanh 'cocos-code-mode:restart-server'.
    // Goi tu renderer: Editor.Ipc.sendToPackage('cocos-code-mode', 'restart-server', port).
    messages: {
        async 'restart-server'(event: any, newPort: number) {
            if (!utcpServer) {
                return;
            }
            utcpServer.stop();
            try {
                const actualPort = await utcpServer.start(newPort);
                Editor.log(`[${PKG_NAME}] UTCP Server restarted on port ${actualPort}`);
                await getConfigManager().updatePort(actualPort);
            } catch (err) {
                Editor.error(`[${PKG_NAME}] Failed to restart UTCP Server: ${err}`);
            }
        }
    }
};
