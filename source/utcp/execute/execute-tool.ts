import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import { ExecuteContext } from './execute-types';
import { getExecuteGuards, registerExecuteGuard } from './execute-guard-registry';
import { safetyGuard } from './guards/safety-guard';
import { serializeGuard } from './guards/serialize-guard';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

// Built-in guard chain — safety first (reject), serialize last (coerce result).
registerExecuteGuard(safetyGuard);
registerExecuteGuard(serializeGuard);

// Editor context: run arbitrary code in the editor main process. Editor, node builtins
// and `args` are injected explicitly (new Function has no closure access).
async function runEditorCode(code: string, args: Record<string, any> | undefined): Promise<any> {
    const fn = new Function('args', 'Editor', 'require', 'fs', 'path', 'os',
        `return (async () => { ${code} })();`) as (...v: any[]) => Promise<any>;
    const result = await fn(args ?? {}, Editor, require, fs, path, os);
    return result === undefined ? null : result;
}

// P1 timeout guard: rejects the HTTP request if execution exceeds timeoutMs so the
// caller is not hung. IMPORTANT LIMITATION: Promise.race cannot interrupt a synchronous
// infinite loop inside the evaluated code — that loop blocks the editor event loop and
// the race timer never gets a chance to fire. This guard protects against *async* hangs
// (an await that never resolves); only out-of-process isolation could stop a sync spin.
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
        if (timer) clearTimeout(timer);
    }
}

export class ExecuteTools {

    @utcpTool(
        'executeJavascript',
        'Execute arbitrary JavaScript. context="scene" runs in the editor scene renderer (edit mode, with cc/cce/document globals); context="editor" runs in the editor main process (with Editor/require/fs/path/os). Use `return <expr>` for a value, `args` for the args object, `await` allowed. Result must be JSON-serializable. Safety regex guard is on by default; pass safety_checks=false only after reviewing risk.',
        {
            type: 'object',
            properties: {
                context: { type: 'string', enum: ['scene', 'editor'], description: 'scene = editor scene renderer (cc/cce/document); editor = editor main process (Editor, fs, asset-db)' },
                code: { type: 'string', description: 'JavaScript to execute. Use `return <expr>` to produce a value; `args` holds the args object.' },
                args: { type: 'object', description: 'Optional JSON object passed to the script as `args`.' },
                safety_checks: { type: 'boolean', description: 'Set false to skip the safety regex guard for this call (default true).' },
                timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 10000). Guards async hangs (await that never resolves); cannot interrupt a synchronous infinite loop — that blocks the editor event loop and only out-of-process isolation could stop it.' },
            },
            required: ['context', 'code']
        },
        { type: 'object', properties: { result: {} } },
        'POST',
        ['execute', 'javascript', 'code', 'scene', 'editor', 'runtime', 'eval']
    )
    async executeJavascript(args: { context: string, code: string, args?: Record<string, any>, safety_checks?: boolean, timeout_ms?: number }): Promise<{ result: any }> {
        const projectPath = (Editor.Project as any).path;
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

        let result: any;
        const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
        if (ctx.context === 'scene') {
            result = await withTimeout(Editor.Message.request('scene', 'execute-scene-script', {
                name: packageJSON.name,
                method: 'runCode',
                args: [ctx.code, ctx.args],
            }), timeoutMs, 'scene');
            // Arbitrary code may mutate the scene — snapshot so undo covers it.
            await Editor.Message.request('scene', 'snapshot');
        } else {
            result = await withTimeout(runEditorCode(ctx.code, ctx.args), timeoutMs, 'editor');
        }

        for (const guard of getExecuteGuards()) {
            if (guard.after) {
                // Deliberate `!== undefined` (not `??`): serializeGuard returns null to
                // coerce non-serializable values (function/BigInt/circular). `?? result`
                // would treat that null as "no change" and resurrect the original value,
                // which then blows up res.json() downstream.
                const guarded = await guard.after(ctx, result);
                if (guarded !== undefined) result = guarded;
            }
        }

        return { result: result === undefined ? null : result };
    }
}
