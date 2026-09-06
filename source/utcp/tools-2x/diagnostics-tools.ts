import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { isPathInside } from '../execute/path-safety';

const execFileAsync = promisify(execFile);

export interface TscDiagnostic {
    file: string;
    line: number;
    column: number;
    code: string;
    message: string;
}

export function parseTscOutput(output: string, projectPath: string): TscDiagnostic[] {
    const diagnostics: TscDiagnostic[] = [];
    const regex = /^(.+)\((\d+),(\d+)\):\s+(?:error|warning)\s+(TS\d+):\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(output)) !== null) {
        diagnostics.push({
            file: path.isAbsolute(match[1]) ? match[1] : path.resolve(projectPath, match[1]),
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            code: match[4],
            message: match[5],
        });
    }
    return diagnostics;
}

export function createTscFailureDiagnostic(output: string, fallbackMessage: string, tsconfig: string): TscDiagnostic[] {
    const message = output.trim() || fallbackMessage.trim() || 'TypeScript compiler exited without diagnostic output.';
    return [{ file: tsconfig, line: 1, column: 1, code: 'TSCCMD', message }];
}

function readCommandErrorField(error: unknown, field: 'stdout' | 'stderr' | 'message'): string {
    if (!error || typeof error !== 'object' || !(field in error)) return '';
    const value: unknown = Reflect.get(error, field);
    if (typeof value === 'string') return value;
    return Buffer.isBuffer(value) ? value.toString('utf-8') : '';
}

function buildSnippet(filePath: string, line: number, contextLines: number): string {
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        const lines = text.split(/\r?\n/);
        const idx = Math.max(0, line - 1);
        const from = Math.max(0, idx - contextLines);
        const to = Math.min(lines.length, idx + contextLines + 1);
        return lines.slice(from, to).join('\n');
    } catch {
        return '';
    }
}

function projectPathOrThrow(): string {
    const projectPath = (Editor.Project as any)?.path;
    if (typeof projectPath !== 'string' || !projectPath) {
        throw new ToolError({
            code: 'PROJECT_PATH_UNAVAILABLE',
            status: 500,
            message: 'Editor.Project.path is not available.',
            recovery: 'Open a Cocos project in Creator 2.4 before running diagnostics.',
        });
    }
    return projectPath;
}

function resolveTsconfig(projectPath: string, tsconfigPath?: string): string {
    const candidate = tsconfigPath
        ? path.resolve(projectPath, tsconfigPath)
        : path.join(projectPath, 'tsconfig.json');
    if (!isPathInside(projectPath, candidate)) {
        throw new ToolError({
            code: 'PATH_ESCAPES_PROJECT',
            status: 400,
            message: `tsconfigPath escapes project boundary: ${tsconfigPath}`,
            recovery: 'Pass a path relative to the project root, e.g. tsconfig.json.',
        });
    }
    if (!fs.existsSync(candidate)) {
        throw new ToolError({
            code: 'TSCONFIG_NOT_FOUND',
            status: 404,
            message: `tsconfig not found: ${candidate}`,
            recovery: 'Creator 2.4 JS projects may lack tsconfig.json. Add one, or pass tsconfigPath.',
        });
    }
    return candidate;
}

export class DiagnosticsTools {

    @utcpTool(
        'runScriptDiagnostics',
        'Run TypeScript no-emit check on the project and return parsed diagnostics (file, line, column, error code, message). Use to validate code after generation/edit.',
        {
            type: 'object',
            properties: {
                tsconfigPath: { type: 'string', description: 'Optional tsconfig path relative to project root. Defaults to project tsconfig.json.' },
            },
        },
        {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                errorCount: { type: 'number' },
                diagnostics: { type: 'array', items: { type: 'object' } },
            },
            required: ['ok', 'errorCount', 'diagnostics'],
        },
        'POST',
        ['diagnostics', 'typescript', 'compile', 'error', 'check', 'validate']
    )
    async runScriptDiagnostics(args: { tsconfigPath?: string } = {}): Promise<{ ok: boolean, errorCount: number, diagnostics: TscDiagnostic[] }> {
        const projectPath = projectPathOrThrow();
        const tsconfig = resolveTsconfig(projectPath, args.tsconfigPath);
        try {
            const { stdout } = await execFileAsync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', tsconfig], {
                cwd: projectPath,
                timeout: 60_000,
                maxBuffer: 10 * 1024 * 1024,
            });
            const diagnostics = parseTscOutput(stdout, projectPath);
            return { ok: diagnostics.length === 0, errorCount: diagnostics.length, diagnostics };
        } catch (err: unknown) {
            const output = readCommandErrorField(err, 'stdout') + readCommandErrorField(err, 'stderr');
            const diagnostics = parseTscOutput(output, projectPath);
            if (diagnostics.length > 0) {
                return { ok: false, errorCount: diagnostics.length, diagnostics };
            }
            const failure = createTscFailureDiagnostic(output, readCommandErrorField(err, 'message'), tsconfig);
            return { ok: false, errorCount: failure.length, diagnostics: failure };
        }
    }

    @utcpTool(
        'getScriptDiagnosticContext',
        'Run TypeScript diagnostics and attach source snippets (±N lines) around each error. Default 10 diagnostics.',
        {
            type: 'object',
            properties: {
                tsconfigPath: { type: 'string', description: 'Optional tsconfig path relative to project root.' },
                contextLines: { type: 'number', description: 'Lines of context around each error (default 3).' },
                limit: { type: 'number', description: 'Max diagnostics to include (default 10).' },
            },
        },
        {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                errorCount: { type: 'number' },
                diagnostics: { type: 'array', items: { type: 'object' } },
            },
            required: ['ok', 'errorCount', 'diagnostics'],
        },
        'POST',
        ['diagnostics', 'typescript', 'compile', 'error', 'snippet', 'context', 'triage']
    )
    async getScriptDiagnosticContext(args: { tsconfigPath?: string, contextLines?: number, limit?: number } = {}): Promise<{ ok: boolean, errorCount: number, diagnostics: (TscDiagnostic & { snippet: string })[] }> {
        const limit = Math.max(1, Math.min(args.limit ?? 10, 100));
        const contextLines = Math.max(0, Math.min(args.contextLines ?? 3, 20));
        const base = await this.runScriptDiagnostics({ tsconfigPath: args.tsconfigPath });
        const diagnostics = base.diagnostics.slice(0, limit).map((d) => ({
            ...d,
            snippet: buildSnippet(d.file, d.line, contextLines),
        }));
        return { ok: base.ok, errorCount: base.errorCount, diagnostics };
    }
}
