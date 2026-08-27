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
            },
            required: ['context', 'code']
        },
        { type: 'object', properties: { result: {} } },
        'POST',
        ['execute', 'javascript', 'code', 'scene', 'editor', 'runtime', 'eval']
    )
    async executeJavascript(args: { context: string, code: string, args?: Record<string, any>, safety_checks?: boolean }): Promise<{ result: any }> {
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
        if (ctx.context === 'scene') {
            result = await Editor.Message.request('scene', 'execute-scene-script', {
                name: packageJSON.name,
                method: 'runCode',
                args: [ctx.code, ctx.args],
            });
            // Arbitrary code may mutate the scene — snapshot so undo covers it.
            await Editor.Message.request('scene', 'snapshot');
        } else {
            result = await runEditorCode(ctx.code, ctx.args);
        }

        for (const guard of getExecuteGuards()) {
            if (guard.after) result = (await guard.after(ctx, result)) ?? result;
        }

        return { result: result === undefined ? null : result };
    }
}
