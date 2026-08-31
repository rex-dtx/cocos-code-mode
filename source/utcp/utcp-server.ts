import express, { Request, Response } from 'express';
import cors from 'cors';
import { ToolRegistry } from './decorators';
import './tools/typescript-defenition';
import './tools/get-properties-tool';
import './tools/set-properties-tool';
import './tools/asset-tools';
import './tools/component-tools';
import './tools/scene-tools';
import './tools/editor-tools';
import './tools/build-tools';
import './tools/program-tools';
import './tools/project-tools';
import './tools/preview-tools';
import './tools/animation-tools';
import './tools/property-array-tools';
import './tools/material-tools';
import './tools/consolidated-tools';
import './execute/execute-tool';
import './tools/diagnostics-tools';
import './tools/file-tools';
import './tools/ui-tools';
import './tools/runtime-tools';
import './tools/batch-tools';
import './tools/batch-read-tools';
import './tools/validation-tools';
import './tools/screenshot-tools';
import './tools/scene-snapshot-tools';
import './tools/event-tools';
import './tools/prefab-json-tools';
import './tools/instruction-tools';
import './tools/preference-tools';
import './tools/input-tools';
import { registerAllImporters } from './utils/asset-importers';
import { slimOutputsSchema } from './utils/schema-slimmer';
import { trimResponse } from './utils/response-trimmer';
import { Tool, UtcpManual } from '@utcp/sdk';
import { parse } from 'qs';
import { getBuildInfo } from '../build-info';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isToolExposed, ToolProfile } from './tool-profiles';
import { createResultEnvelope } from './response-envelope';

// ponytail: debug log to file, not console — avoid polluting editor output.
// Mutable so the menu toggle (toggleDebug) can flip it at runtime, not just via env var.
let debugEnabled = process.env.UTCP_DEBUG === '1' || process.env.UTCP_DEBUG === 'true';
const DEBUG_LOG_DIR = join(homedir(), '.utcp-debug');
let debugLogFile = join(DEBUG_LOG_DIR, `utcp-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

if (debugEnabled) {
    try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {}
    console.log(`[UTCP] Debug mode ON → ${debugLogFile}`);
}

function debugLog(entry: Record<string, any>): void {
    if (!debugEnabled) return;
    try {
        // lazy mkdir: toggling on via menu means dir may not exist yet
        try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {}
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
        appendFileSync(debugLogFile, line + '\n');
    } catch {}
}

// Profile config — mutable at runtime via panel.
let activeProfile: ToolProfile = 'full'; // default: expose everything (backward compat)
let enabledTools = new Set<string>();
let disabledTools = new Set<string>();
let envelopeEnabled = false; // default OFF for backward compat

export function getServerProfile(): { profile: ToolProfile, enabled: string[], disabled: string[], envelope: boolean } {
    return { profile: activeProfile, enabled: [...enabledTools], disabled: [...disabledTools], envelope: envelopeEnabled };
}

export function setServerProfile(profile: ToolProfile, enabled: string[] = [], disabled: string[] = [], envelope: boolean = false): void {
    activeProfile = profile;
    enabledTools = new Set(enabled);
    disabledTools = new Set(disabled);
    envelopeEnabled = envelope;
    console.log(`[UTCP] Profile set to '${profile}', envelope=${envelope}, enabled=${enabled.length}, disabled=${disabled.length}`);
}

export class UtcpServerManager {
    private app: express.Application;
    private server: any;
    // Resolved port after start(); used by unload to GC the config entry.
    public port: number = 0;

    constructor() {
        this.app = express();
        registerAllImporters();
    }

    async start(port: number = 3000): Promise<number> {
        // PHAI set TRUOC moi app.use(): express bind 'query parser fn' luc lazyrouter
        // chay (o use() dau tien) va khong doc lai. Set sau -> decoder nay khong bao gio
        // chay, moi arg so/bool ve tay tool duoi dang string.
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
        this.app.use(express.json({ limit: '50mb' }));

        // M1 timing baseline: stamp request start so handlers and clients can
        // measure wall time (via X-Duration-Ms header) before/after batching.
        this.app.use((req: any, _res: any, next: any) => {
            req._t0 = Date.now();
            next();
        });

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
                this.port = currentPort;
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
            // ponytail: slim outputs schema to top-level keys only; nested detail is token bloat.
            // Inputs schemas stay intact — Claude needs full param shape to call correctly.
            if (toolDef.outputs) {
                toolDef.outputs = slimOutputsSchema(toolDef.outputs);
            }
            const toolUrlPath = toolDef.tool_call_template.url;

            toolDef.tool_call_template.url = `${baseUrl}${toolUrlPath}`;

            // Profile annotations remain in ToolProfileRegistry. The Code Mode manual parser
            // rejects unknown per-tool fields, so do not expose them in the UTCP manual.

            utcpTools.push(toolDef);

            // Register specific endpoint
            const handler = async (req: Request, res: Response) => {
                const t0 = Date.now();
                try {
                    // Check profile exposure
                    if (!isToolExposed(toolDef.name, activeProfile, enabledTools, disabledTools)) {
                        res.status(404).json({ error: `Tool '${toolDef.name}' is not exposed by the current profile '${activeProfile}'.` });
                        return;
                    }

                    const args = { ...(req.query as any), ...((req as any).body || {}) } as any;

                    debugLog({
                        type: 'request',
                        tool: toolDef.name,
                        method: req.method,
                        url: req.originalUrl,
                        args
                    });

                    let result = await toolMeta.method.apply(instance, [args]);

                    if (result === undefined || result === null) {
                        const ms = Date.now() - ((req as any)._t0 ?? t0);
                        res.setHeader('X-Duration-Ms', String(ms));
                        debugLog({ type: 'response', tool: toolDef.name, result: null, size: 0, durationMs: ms });
                        res.json(null);
                        return;
                    }

                    const ms = Date.now() - ((req as any)._t0 ?? t0);
                    res.setHeader('X-Duration-Ms', String(ms));
                    debugLog({ type: 'response', tool: toolDef.name, result, size: JSON.stringify(result).length, durationMs: ms });

                    // ponytail: trim null/undefined/empty containers before serializing.
                    // Reduces response payload ~15-30% for property dumps and nested objects.
                    const trimmed = trimResponse(result);

                    // Wrap in envelope if enabled
                    if (envelopeEnabled) {
                        res.json(createResultEnvelope(toolDef.name, args, trimmed ?? null));
                    } else {
                        res.json(trimmed ?? null);
                    }

                } catch (err: any) {
                    console.error(`Error in tool ${toolDef.name}:`, err);
                    const ms2 = Date.now() - ((req as any)._t0 ?? t0);
                    res.setHeader('X-Duration-Ms', String(ms2));
                    debugLog({ type: 'error', tool: toolDef.name, error: err.message, durationMs: ms2 });
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

        // Serve UTCP Manual
        this.app.get('/utcp', (req, res) => {
            // Filter tools based on active profile
            const filteredTools = utcpTools.filter(t => isToolExposed(t.name, activeProfile, enabledTools, disabledTools));
            const manual: UtcpManual = {
                utcp_version: "1.0.1",
                manual_version: "1.0.0",
                tools: filteredTools
            };
            // Do NOT add fields here. The UTCP SDK validates the manual with a strict
            // schema: an extra key fails registration for EVERY tool, not just itself.
            // Build provenance lives on /build-info below for exactly this reason.
            res.json(manual);
        });

        // Provenance on its own endpoint, out of the manual's strict schema.
        this.app.get('/build-info', (req, res) => {
            res.json(getBuildInfo());
        });

        // ponytail: debug log viewer — GET /debug-logs returns all log entries as JSON array
        // GET /debug-logs?tool=X filters by tool name; ?last=N returns last N entries
        this.app.get('/debug-logs', (req, res) => {
            if (!debugEnabled) {
                res.status(404).json({ error: 'Debug mode not enabled. Toggle via menu or set UTCP_DEBUG=1.' });
                return;
            }
            try {
                const files = readdirSync(DEBUG_LOG_DIR)
                    .filter(f => f.endsWith('.jsonl'))
                    .sort()
                    .reverse();
                if (files.length === 0) {
                    res.json([]);
                    return;
                }
                const content = readFileSync(join(DEBUG_LOG_DIR, files[0]), 'utf-8');
                let entries = content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

                const toolFilter = req.query.tool as string | undefined;
                if (toolFilter) {
                    entries = entries.filter(e => e.tool === toolFilter);
                }
                const lastN = Number(req.query.last);
                if (lastN > 0) {
                    entries = entries.slice(-lastN);
                }
                res.json(entries);
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log("UTCP Server stopped");
        }
    }

    // ponytail: runtime toggle for debug logging — no restart needed
    toggleDebug(): boolean {
        debugEnabled = !debugEnabled;
        if (debugEnabled) {
            try { mkdirSync(DEBUG_LOG_DIR, { recursive: true }); } catch {}
            console.log(`[UTCP] Debug mode ON → ${debugLogFile}`);
        } else {
            console.log('[UTCP] Debug mode OFF');
        }
        return debugEnabled;
    }
}
