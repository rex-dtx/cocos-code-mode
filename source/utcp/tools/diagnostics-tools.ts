import { utcpTool } from '../decorators';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { VERBOSE_DIAGNOSTICS_LIMIT } from '../utils/verbose';

const execFileAsync = promisify(execFile);

interface TscDiagnostic {
    file: string;
    line: number;
    column: number;
    code: string;
    message: string;
}

// Parse tsc --noEmit --pretty false output into structured diagnostics.
// Format: "file(line,col): error TSxxxx: message"
function parseTscOutput(output: string, projectPath: string): TscDiagnostic[] {
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
    return [{
        file: tsconfig,
        line: 1,
        column: 1,
        code: 'TSCCMD',
        message,
    }];
}

function readCommandErrorField(error: unknown, field: 'stdout' | 'stderr' | 'message'): string {
    if (!error || typeof error !== 'object' || !(field in error)) return '';
    const value: unknown = Reflect.get(error, field);
    if (typeof value === 'string') return value;
    return Buffer.isBuffer(value) ? value.toString('utf-8') : '';
}

function buildSnippet(filePath: string, line: number, contextLines: number): string {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const start = Math.max(0, line - 1 - contextLines);
        const end = Math.min(lines.length, line + contextLines);
        const snippet: string[] = [];
        for (let i = start; i < end; i++) {
            const marker = i === line - 1 ? '>' : ' ';
            snippet.push(`${marker} ${i + 1} | ${lines[i]}`);
        }
        return snippet.join('\n');
    } catch {
        return '';
    }
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
    async runScriptDiagnostics(args: { tsconfigPath?: string }): Promise<{ ok: boolean, errorCount: number, diagnostics: TscDiagnostic[] }> {
        const projectPath = (Editor.Project as any).path as string;
        const tsconfig = args.tsconfigPath ? path.resolve(projectPath, args.tsconfigPath) : path.join(projectPath, 'tsconfig.json');

        if (!fs.existsSync(tsconfig)) {
            throw new Error(`tsconfig not found: ${tsconfig}`);
        }

        try {
            const { stdout } = await execFileAsync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', tsconfig], {
                cwd: projectPath,
                timeout: 60_000,
                maxBuffer: 10 * 1024 * 1024,
            });
            // tsc exits 0 with no output when clean
            const diagnostics = parseTscOutput(stdout, projectPath);
            return { ok: diagnostics.length === 0, errorCount: diagnostics.length, diagnostics };
        } catch (err: unknown) {
            // TypeScript uses a non-zero exit for compiler errors, but project-level
            // failures (for example no inputs or a missing compiler) have no file location.
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
        'Run TypeScript diagnostics and attach source snippets (±N lines) around each error for immediate triage without separate file reads. Default 10 diagnostics; verbose=true lifts to 100.',
        {
            type: 'object',
            properties: {
                tsconfigPath: { type: 'string', description: 'Optional tsconfig path relative to project root.' },
                contextLines: { type: 'number', description: 'Lines of context around each error (default 3).' },
                limit: { type: 'number', description: 'Max diagnostics to include (default 10).' },
                verbose: { type: 'boolean', description: 'When true, lifts limit ceiling from 50 to 100.' },
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
    async getScriptDiagnosticContext(args: { tsconfigPath?: string, contextLines?: number, limit?: number, verbose?: boolean }): Promise<{ ok: boolean, errorCount: number, diagnostics: (TscDiagnostic & { snippet: string })[] }> {
        const ceiling = args.verbose ? VERBOSE_DIAGNOSTICS_LIMIT : 50;
        const limit = Math.max(1, Math.min(args.limit ?? 10, ceiling));
        const contextLines = Math.max(0, Math.min(args.contextLines ?? 3, 20));

        // Reuse runScriptDiagnostics logic
        const base = await this.runScriptDiagnostics({ tsconfigPath: args.tsconfigPath });
        const enriched = base.diagnostics.slice(0, limit).map(d => ({
            ...d,
            snippet: buildSnippet(d.file, d.line, contextLines),
        }));

        return { ok: base.ok, errorCount: base.errorCount, diagnostics: enriched };
    }
}
