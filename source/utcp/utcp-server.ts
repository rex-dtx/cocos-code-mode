import express, { Request, Response } from 'express';
import cors from 'cors';
import { ToolRegistry } from './decorators';
// Tool 3.x — dung Editor.Message.request, API do KHONG ton tai o 2.4.15.
// Giu file lai de doc khi port vong 2; tools-2x thay the tu phase 4.
// import './tools/typescript-defenition';
// import './tools/get-properties-tool';
// import './tools/set-properties-tool';
// import './tools/asset-tools';
// import './tools/component-tools';
// import './tools/scene-tools';
// import './tools/editor-tools';
// import './tools/build-tools';
// import './tools/program-tools';
// import './tools/project-tools';
// import './tools/preview-tools';
// import './tools/animation-tools';
// import { registerAllImporters } from './utils/asset-importers';   // .meta 3.x
import './tools-2x/asset-read-tools';
import './tools-2x/asset-write-tools';
import './tools-2x/scene-read-tools';
import './tools-2x/deep-read-tools';
import './tools-2x/component-method-tools';
import './tools-2x/scene-misc-tools';
import './tools-2x/scene-probe-tools';
import './tools-2x/scene-write-tools';
import './tools-2x/editor-misc-tools';
import './tools-2x/editor-extra-tools';
import './tools-2x/program-tools';
import './tools-2x/clipboard-tools';
import './tools-2x/animation-tools';
import { Tool, UtcpManual } from '@utcp/sdk';
import { parse } from 'qs';
import { getBuildInfo } from '../build-info';
import { trimResponse } from './utils/response-trimmer';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let debugEnabled = process.env.UTCP_DEBUG === '1' || process.env.UTCP_DEBUG === 'true';
const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');
let debugLogFile = join(DEBUG_LOG_DIR, `utcp-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
if (debugEnabled) { try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {} console.log(`[UTCP] Debug mode ON -> ${debugLogFile}`); }
function debugLog(entry: Record<string, any>): void { if (!debugEnabled) return; try { try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {} const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }); appendFileSync(debugLogFile, line + '\n'); } catch {} }

export class UtcpServerManager {
    private app: express.Application;
    private server: any;

    constructor() {
        this.app = express();
        // registerAllImporters();   // asset-importers doc .meta 3.x — port o vong 2
    }

    async start(port: number = 3000): Promise<number> {
        // PHAI set TRUOC moi app.use(): express bind 'query parser fn' luc lazyrouter
        // chay (o use() dau tien). Set sau -> decoder nay khong bao gio chay, moi arg
        // ve tay tool duoi dang string.
        this.app.set("query parser", (queryString: string) =>
            parse(queryString, {
                decoder(value, defaultDecoder, charset, type) {
                    const decoded = defaultDecoder(value);

                    if (decoded === "true") return true;
                    if (decoded === "false") return false;

                    if (
                        typeof decoded === "string" &&
                        decoded !== "" &&
                        !Number.isNaN(Number(decoded))
                    ) {
                        return Number(decoded);
                    }

                    if (decoded === "__null__") return null;

                    return decoded;
                }
            })
        );

        this.app.use(cors());
        // C2.4 uses rawCreator form-data in places; ensure JSON body is parsed even when
        // express.json's default type filter rejects custom content-types.
        this.app.use(express.json({ type: '*/*' }));
        this.app.use(express.urlencoded({ extended: false }));

        const tools = ToolRegistry.getTools();
        const toolInstances = new Map<Function, any>();
        const utcpTools: Tool[] = [];

        let currentPort = port;

        // Let's listen first to get the port if it's 0
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, "127.0.0.1", () => {
                const addr = this.server.address();
                if (addr && typeof addr === 'object') {
                    currentPort = addr.port;
                }

                // Now register tools with the correct port
                this.registerTools(currentPort, tools, toolInstances, utcpTools);

                resolve(currentPort);
            });
            this.server.on('error', (err: any) => {
                reject(err);
            });
        });
    }

    private registerTools(port: number, tools: any[], toolInstances: Map<Function, any>, utcpTools: Tool[]) {
        const baseUrl = `http://localhost:${port}`;

        // Initialize tool instances and build UTCP definitions
        for (const toolMeta of tools) {
            const ToolClass = toolMeta.target.constructor;
            let instance = toolInstances.get(ToolClass);
            if (!instance) {
                instance = new ToolClass();
                toolInstances.set(ToolClass, instance);
            }

            const toolDef = JSON.parse(JSON.stringify(toolMeta.tool));
            const toolUrlPath = toolDef.tool_call_template.url;

            toolDef.tool_call_template.url = `${baseUrl}${toolUrlPath}`;

            utcpTools.push(toolDef);

            // Register specific endpoint
            const handler = async (req: Request, res: Response) => {
                const t0 = Date.now();
                try {
                    const queryArgs = req.query as Record<string, any>;
                    const bodyArgs = (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) ? req.body : {};
                    const args = req.method === 'GET' ? queryArgs : { ...queryArgs, ...bodyArgs };
                    debugLog({ type: 'request', tool: toolDef.name, method: req.method, url: req.originalUrl, args });
                    let result = await toolMeta.method.apply(instance, [args]);
                    if (result === undefined || result === null) {
                        debugLog({ type: 'response', tool: toolDef.name, result: null, size: 0, durationMs: Date.now() - t0 });
                        res.json(null);
                        return;
                    }
                    debugLog({ type: 'response', tool: toolDef.name, result, size: JSON.stringify(result).length, durationMs: Date.now() - t0 });
                    const trimmed = trimResponse(result);
                    res.json(trimmed ?? null);
                } catch (err: any) {
                    console.error(`Error in tool ${toolDef.name}:`, err);
                    debugLog({ type: 'error', tool: toolDef.name, error: err.message, durationMs: Date.now() - t0 });
                    res.status(500).json({ error: err.message });
                }
            };

            switch (toolDef.tool_call_template.http_method) {
                case 'POST':
                    this.app.post(toolUrlPath, handler);
                    break;
                case 'GET':
                    this.app.get(toolUrlPath, handler);
                    break;
                case 'DELETE':
                    this.app.delete(toolUrlPath, handler);
                    break;
                case 'PUT':
                    this.app.put(toolUrlPath, handler);
                    break;
                default:
                // throw new Error(`Unsupported HTTP method: ${toolDef.tool_call_template.http_method}`);
            }
        }

        // Serve UTCP Manual — must NOT add extra top-level fields (UTCP spec strict).
        this.app.get('/utcp', (req, res) => {
            const manual: UtcpManual = {
                utcp_version: "1.0.1",
                manual_version: "1.0.0",
                tools: utcpTools
            };
            res.json(manual);
        });

        // Build provenance — separate endpoint, not part of UTCP manual schema.
        this.app.get('/build-info', (req, res) => {
            res.json(getBuildInfo());
        });

        this.app.get('/debug-logs', (req, res) => {
            if (!debugEnabled) { res.status(404).json({ error: 'Debug mode not enabled. Toggle via menu or set UTCP_DEBUG=1.' }); return; }
            try {
                const files = readdirSync(DEBUG_LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
                if (files.length === 0) { res.json([]); return; }
                const content = readFileSync(join(DEBUG_LOG_DIR, files[0]), 'utf-8');
                let entries = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
                const toolFilter = req.query.tool as string | undefined;
                if (toolFilter) entries = entries.filter(e => e.tool === toolFilter);
                const lastN = Number(req.query.last);
                if (lastN > 0) entries = entries.slice(-lastN);
                res.json(entries);
            } catch (err: any) { res.status(500).json({ error: err.message }); }
        });
    }

    toggleDebug(): boolean {
        debugEnabled = !debugEnabled;
        if (debugEnabled) { try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {} console.log(`[UTCP] Debug mode ON -> ${debugLogFile}`); } else { console.log('[UTCP] Debug mode OFF'); }
        return debugEnabled;
    }

    async stop(): Promise<void> {
        const server = this.server;
        if (!server) return;

        await new Promise<void>((resolve, reject) => {
            server.close((err?: Error) => {
                this.server = null;
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("UTCP Server stopped");
    }
}
