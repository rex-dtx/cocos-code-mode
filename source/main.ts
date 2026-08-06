import { UtcpServerManager } from './utcp/utcp-server';
import { getConfigManager } from './utcp/config-manager';
import { writeFileSync } from 'fs';
import { join } from 'path';

const PKG_NAME = 'cocos-code-mode';

let utcpServer: UtcpServerManager | null = null;

// TAM THOI (phase 3) — xoa sau phase 6.
// Chay probe + echo, ghi ket qua ra file (Editor.log co the truncate JSON dai).
let probeDone = false;
function runProbe() {
    if (probeDone) { return; }
    probeDone = true;

    const result: any = {};
    const outFile = join(__dirname, '..', 'probe-result.json');

    Editor.Scene.callSceneScript(PKG_NAME, 'echo-args', 'x', 42, { k: 1 }, (err: any, r: any) => {
        result.echo = err ? { error: String(err && err.message || err) } : r;

        Editor.Scene.callSceneScript(PKG_NAME, 'probe', (err2: any, r2: any) => {
            result.probe = err2 ? { error: String(err2 && err2.message || err2) } : r2;

            Editor.Scene.callSceneScript(PKG_NAME, 'probe2', (err3: any, r3: any) => {
                result.probe2 = err3 ? { error: String(err3 && err3.message || err3) } : r3;
                try {
                    writeFileSync(outFile, JSON.stringify(result, null, 2));
                    Editor.log(`[${PKG_NAME}] probe written to ${outFile}`);
                } catch (e) {
                    Editor.error(`[${PKG_NAME}] probe write failed: ${e}`);
                }
            });
        });
    });
}

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
        },

        // TAM THOI (phase 3) — xoa sau phase 6. Dump engine API that ra file.
        'probe'(event: any) {
            probeDone = false;
            runProbe();
        },

        // scene:ready la full message (co ':') — broadcast cua builtin package 'scene'.
        // Doc: v2.4/extension/reference/ipc-reference.md
        // Dung de auto-trigger probe khi scene mo xong, khong can go tay trong devtools.
        'scene:ready'(event: any) {
            runProbe();
        }
    }
};
