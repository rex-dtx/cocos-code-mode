import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { ExecuteContext } from './execute-types';
import { getExecuteGuards, registerExecuteGuard } from './execute-guard-registry';
import { safetyGuard } from './guards/safety-guard';
import { serializeGuard } from './guards/serialize-guard';
import { sceneScript } from '../utils/ipc-promise';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

registerExecuteGuard(safetyGuard);
registerExecuteGuard(serializeGuard);

async function runEditorCode(code: string, args: Record<string, unknown> | undefined): Promise<unknown> {
    const fn = new Function('args', 'Editor', 'require', 'fs', 'path', 'os',
        `return (async () => { ${code} })();`) as (...v: unknown[]) => Promise<unknown>;
    const editorObj = typeof Editor !== 'undefined' ? Editor : (globalThis as Record<string, unknown>).Editor;
    const result = await fn(args ?? {}, editorObj, require, fs, path, os);
    return result === undefined ? null : result;
}

const DEFAULT_TIMEOUT_MS = 10_000;
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`executeJavascript ${label} timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
export class ExecuteTools {
    @utcpTool(
        'executeJavascript',
        'Execute arbitrary JavaScript. context="scene" runs in the editor scene renderer (with cc/Editor/document globals); context="editor" runs in the editor main process (with Editor/require/fs/path/os). Use `return <expr>` for a value, `args` for the args object, `await` allowed. Result must be JSON-serializable. Safety regex guard is on by default; pass safety_checks=false only after reviewing risk.',
        {
            type: 'object',
            properties: {
                context: { type: 'string', enum: ['scene', 'editor'], description: 'scene = editor scene renderer (cc/Editor/document); editor = editor main process (Editor, fs, asset-db)' },
                code: { type: 'string', description: 'JavaScript to execute. Use `return <expr>` to produce a value; `args` holds the args object.' },
                args: { type: 'object', description: 'Optional JSON object passed to the script as `args`.' },
                safety_checks: { type: 'boolean', description: 'Set false to skip the safety regex guard for this call (default true).' },
                timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 10000). Guards async hangs (await that never resolves); cannot interrupt a synchronous infinite loop.' },
            },
            required: ['context', 'code']
        },
        { type: 'object', properties: { result: {} } },
        'POST',
        ['execute', 'javascript', 'code', 'scene', 'editor', 'runtime', 'eval']
    )
    async executeJavascript(args: { context: string, code: string, args?: Record<string, unknown>, safety_checks?: boolean, timeout_ms?: number }): Promise<{ result: unknown }> {
        try {
            const editorObj = typeof Editor !== 'undefined' ? Editor : (globalThis as Record<string, unknown>).Editor as { Project?: { path?: string } } | undefined;
            const projectPath = editorObj?.Project?.path || process.cwd();
            let ctx: ExecuteContext = {
                context: args.context === 'editor' ? 'editor' : 'scene',
                code: args.code,
                args: args.args,
                projectPath,
                safetyChecks: args.safety_checks !== false,
            };

            for (const guard of getExecuteGuards()) {
                if (guard.before) ctx = (await guard.before(ctx)) ?? ctx;
            }

            let result: unknown;
            const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
            if (ctx.context === 'scene') {
                result = await withTimeout(sceneScript<unknown>('run-code', ctx.code, ctx.args), timeoutMs, 'scene');
            } else {
                result = await withTimeout(runEditorCode(ctx.code, ctx.args), timeoutMs, 'editor');
            }

            for (const guard of getExecuteGuards()) {
                if (guard.after) {
                    const guarded = await guard.after(ctx, result);
                    if (guarded !== undefined) result = guarded;
                }
            }

            return { result: result === undefined ? null : result };
        } catch (err: unknown) {
            if (err instanceof ToolError) throw err;
            const message = err instanceof Error ? err.message : String(err);
            if (/safety checks blocked/i.test(message)) {
                throw new ToolError({
                    code: 'SAFETY_BLOCKED',
                    status: 400,
                    message,
                    recovery: 'Use project-relative file tools, or pass safety_checks=false after reviewing risk.',
                });
            }
            if (/timed out/i.test(message)) {
                throw new ToolError({
                    code: 'TIMEOUT',
                    status: 422,
                    message,
                    recovery: 'Increase timeout_ms or avoid awaiting a promise that never settles.',
                });
            }
            throw new ToolError({
                code: 'SCRIPT_ERROR',
                status: 422,
                message,
                recovery: 'Fix the script. The error message is the thrown/syntax/runtime failure.',
            });
        }
    }
}
