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
import { JsonSchema, Tool, UtcpManual } from '@utcp/sdk';
import { parse } from 'qs';
import { getBuildInfo } from '../build-info';
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isToolExposed, ToolProfile } from './tool-profiles';
import { createResultEnvelope } from './response-envelope';
import { toToolErrorResponse } from './tool-error';

export interface SchemaValidationError {
    path: string;
    keyword: string;
    message: string;
}

function isPlainJsonObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is JsonSchema {
    return isPlainJsonObject(value);
}

function schemaKeywordNumber(schema: JsonSchema, keyword: string): number | undefined {
    const value = schema[keyword];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function schemaKeywordSchemas(schema: JsonSchema, keyword: string): JsonSchema[] {
    const value = schema[keyword];
    return Array.isArray(value) ? value.filter(isSchema) : [];
}

function schemaKeywordSchema(schema: JsonSchema, keyword: string): JsonSchema | undefined {
    const value = schema[keyword];
    return isSchema(value) ? value : undefined;
}

function propertyPath(path: string, property: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)) {
        return path === '$' ? property : `${path}.${property}`;
    }
    return `${path}[${JSON.stringify(property)}]`;
}


function matchesJsonValue(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => matchesJsonValue(value, right[index]));
    }
    if (isPlainJsonObject(left) && isPlainJsonObject(right)) {
        const leftObject = left as Record<string, unknown>;
        const rightObject = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftObject);
        const rightKeys = Object.keys(rightObject);
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightObject, key) && matchesJsonValue(leftObject[key], rightObject[key]));
    }
    return false;
}

function matchesSchemaType(value: unknown, type: string): boolean {
    switch (type) {
        case 'object':
            return isPlainJsonObject(value);
        case 'array':
            return Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

function schemaTypes(schema: JsonSchema): string[] {
    if (typeof schema.type === 'string') {
        return [schema.type];
    }
    return Array.isArray(schema.type) ? schema.type.filter((type): type is string => typeof type === 'string') : [];
}

function validateSchemaValue(schema: JsonSchema, value: unknown, path: string): SchemaValidationError[] {
    const errors: SchemaValidationError[] = [];
    const types = schemaTypes(schema);

    if (types.length > 0 && !types.some((type) => matchesSchemaType(value, type))) {
        errors.push({
            path,
            keyword: 'type',
            message: `Expected ${types.join(' or ')}.`,
        });
        return errors;
    }

    if (schema.const !== undefined && !matchesJsonValue(value, schema.const)) {
        errors.push({ path, keyword: 'const', message: 'Must equal the declared constant.' });
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => matchesJsonValue(value, candidate))) {
        errors.push({ path, keyword: 'enum', message: 'Must equal one of the declared values.' });
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const minimum = schemaKeywordNumber(schema, 'minimum');
        const maximum = schemaKeywordNumber(schema, 'maximum');
        if (minimum !== undefined && value < minimum) {
            errors.push({ path, keyword: 'minimum', message: `Must be at least ${minimum}.` });
        }
        if (maximum !== undefined && value > maximum) {
            errors.push({ path, keyword: 'maximum', message: `Must be at most ${maximum}.` });
        }
    }

    if (typeof value === 'string') {
        const minLength = schemaKeywordNumber(schema, 'minLength');
        const maxLength = schemaKeywordNumber(schema, 'maxLength');
        if (minLength !== undefined && value.length < minLength) {
            errors.push({ path, keyword: 'minLength', message: `Must contain at least ${minLength} characters.` });
        }
        if (maxLength !== undefined && value.length > maxLength) {
            errors.push({ path, keyword: 'maxLength', message: `Must contain at most ${maxLength} characters.` });
        }
    }

    if (Array.isArray(value)) {
        const minItems = schemaKeywordNumber(schema, 'minItems');
        const maxItems = schemaKeywordNumber(schema, 'maxItems');
        if (minItems !== undefined && value.length < minItems) {
            errors.push({ path, keyword: 'minItems', message: `Must contain at least ${minItems} items.` });
        }
        if (maxItems !== undefined && value.length > maxItems) {
            errors.push({ path, keyword: 'maxItems', message: `Must contain at most ${maxItems} items.` });
        }
        const itemSchema = schema.items;
        if (isSchema(itemSchema)) {
            value.forEach((item, index) => errors.push(...validateSchemaValue(itemSchema, item, `${path}[${index}]`)));
        } else if (Array.isArray(itemSchema)) {
            itemSchema.forEach((tupleItemSchema, index) => {
                if (isSchema(tupleItemSchema) && index < value.length) {
                    errors.push(...validateSchemaValue(tupleItemSchema, value[index], `${path}[${index}]`));
                }
            });
        }
    }

    if (isPlainJsonObject(value)) {
        const objectValue = value as Record<string, unknown>;
        const required = Array.isArray(schema.required) ? schema.required.filter((property): property is string => typeof property === 'string') : [];
        for (const property of required) {
            if (!Object.prototype.hasOwnProperty.call(objectValue, property) || objectValue[property] === undefined) {
                errors.push({ path: propertyPath(path, property), keyword: 'required', message: 'Required property is missing.' });
            }
        }

        if (isPlainJsonObject(schema.properties)) {
            for (const [property, propertySchema] of Object.entries(schema.properties)) {
                if (Object.prototype.hasOwnProperty.call(objectValue, property) && objectValue[property] !== undefined && isSchema(propertySchema)) {
                    errors.push(...validateSchemaValue(propertySchema, objectValue[property], propertyPath(path, property)));
                }
            }
        }
    }

    for (const variant of schemaKeywordSchemas(schema, 'allOf')) {
        errors.push(...validateSchemaValue(variant, value, path));
    }

    const anyOf = schemaKeywordSchemas(schema, 'anyOf');
    if (anyOf.length > 0 && !anyOf.some((variant) => validateSchemaValue(variant, value, path).length === 0)) {
        errors.push({ path, keyword: 'anyOf', message: 'Value must match at least one schema.' });
    }

    const oneOf = schemaKeywordSchemas(schema, 'oneOf');
    if (oneOf.length > 0 && oneOf.filter((variant) => validateSchemaValue(variant, value, path).length === 0).length !== 1) {
        errors.push({ path, keyword: 'oneOf', message: 'Value must match exactly one schema.' });
    }

    const condition = schemaKeywordSchema(schema, 'if');
    if (condition) {
        const branch = validateSchemaValue(condition, value, path).length === 0
            ? schemaKeywordSchema(schema, 'then')
            : schemaKeywordSchema(schema, 'else');
        if (branch) {
            errors.push(...validateSchemaValue(branch, value, path));
        }
    }

    return errors;
}

export function validateSchemaArguments(schema: JsonSchema, args: unknown): SchemaValidationError[] {
    return validateSchemaValue(schema, args, '$');
}

export function findMissingRequiredInputs(schema: JsonSchema, args: Record<string, unknown>): string[] {
    return validateSchemaArguments(schema, args)
        .filter((error) => error.keyword === 'required' && !error.path.includes('.') && !error.path.includes('['))
        .map((error) => error.path);
}

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

                    const body = req.body as unknown;
                    const bodyArgs = isPlainJsonObject(body) ? body as Record<string, unknown> : {};
                    const args: Record<string, unknown> = {
                        ...(req.query as unknown as Record<string, unknown>),
                        ...bodyArgs,
                    };
                    const validationErrors = body === undefined || isPlainJsonObject(body)
                        ? validateSchemaArguments(toolDef.inputs, args)
                        : validateSchemaArguments(toolDef.inputs, body);
                    if (validationErrors.length > 0) {
                        const missingInputs = validationErrors
                            .filter((error) => error.keyword === 'required' && !error.path.includes('.') && !error.path.includes('['))
                            .map((error) => error.path);
                        const plural = missingInputs.length === 1 ? '' : 's';
                        res.status(400).json({
                            error: missingInputs.length > 0
                                ? `Missing required input${plural}: ${missingInputs.join(', ')}`
                                : 'Invalid tool input.',
                            ...(missingInputs.length > 0 ? { missingInputs } : {}),
                            validationErrors,
                        });
                        return;
                    }

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
                    const response = toToolErrorResponse(err);
                    res.setHeader('X-Duration-Ms', String(ms2));
                    debugLog({ type: 'error', tool: toolDef.name, error: response.body.error, durationMs: ms2 });
                    res.status(response.status).json(response.body);
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

    async stop(): Promise<void> {
        const server = this.server;
        if (!server) return;

        await new Promise<void>((resolve, reject) => {
            server.close((err?: Error) => {
                this.server = null;
                this.port = 0;
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("UTCP Server stopped");
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
