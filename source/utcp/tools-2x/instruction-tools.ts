import fs from 'fs';
import path from 'path';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { isPathInside } from '../execute/path-safety';

const MAX_FILE_BYTES = 512 * 1024;
const VERBOSE_FILE_BYTES = 10 * 1024 * 1024;

function projectPathOrThrow(): string {
    const projectPath = (Editor.Project as any)?.path;
    if (typeof projectPath !== 'string' || !projectPath) {
        throw new ToolError({
            code: 'PROJECT_PATH_UNAVAILABLE',
            status: 500,
            message: 'Editor.Project.path is not available.',
            recovery: 'Open a Cocos project in Creator 2.4 before reading instruction files.',
        });
    }
    return projectPath;
}

export function resolveInstructionPath(projectPath: string, relPath: string): string {
    const resolved = path.resolve(projectPath, relPath || '.');
    if (!isPathInside(projectPath, resolved)) {
        throw new ToolError({
            code: 'PATH_ESCAPES_PROJECT',
            status: 400,
            message: `Path escapes project boundary: ${relPath}`,
            recovery: 'Pass a project-relative path such as AGENTS.md or docs/rules.md.',
        });
    }
    return resolved;
}

function refreshIfAsset(projectPath: string, resolved: string): void {
    const relToProject = path.relative(projectPath, resolved).replace(/\\/g, '/');
    if (!relToProject.startsWith('assets/') && relToProject !== 'assets') return;
    try {
        Editor.assetdb.refresh(`db://${relToProject}`, (() => { /* fire-and-forget */ }) as any);
    } catch {
        // Write itself succeeded; asset-db reimport is owned by the editor.
    }
}

export class InstructionTools {

    @utcpTool(
        'readProjectInstruction',
        'Read a project instruction file (AGENTS.md, CLAUDE.md, GEMINI.md, rules/*.md). Returns content or not-found. Default 512KB; verbose=true lifts to 10MB.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path, e.g. "AGENTS.md"' },
                verbose: { type: 'boolean', description: 'When true, lifts size cap to 10MB.' },
            },
            required: ['filePath'],
        },
        {
            type: 'object',
            properties: {
                content: { type: 'string' },
                exists: { type: 'boolean' },
                filePath: { type: 'string' },
                bytes: { type: 'number' },
            },
            required: ['content', 'exists', 'filePath'],
        },
        'GET',
        ['instruction', 'project', 'read', 'agent', 'prompt', 'AGENTS', 'CLAUDE']
    )
    async readProjectInstruction(args: { filePath: string, verbose?: boolean }): Promise<{ content: string, exists: boolean, filePath: string, bytes: number }> {
        const projectPath = projectPathOrThrow();
        const resolved = resolveInstructionPath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) {
            return { content: '', exists: false, filePath: args.filePath, bytes: 0 };
        }
        const stat = fs.statSync(resolved);
        const cap = args.verbose ? VERBOSE_FILE_BYTES : MAX_FILE_BYTES;
        if (stat.size > cap) {
            throw new ToolError({
                code: 'FILE_TOO_LARGE',
                status: 422,
                message: `Instruction file too large (${stat.size} bytes, cap ${cap}).`,
                recovery: args.verbose ? 'Already at verbose cap (10MB). Split the file.' : 'Pass verbose=true to lift to 10MB.',
            });
        }
        const content = fs.readFileSync(resolved, 'utf8');
        return { content, exists: true, filePath: args.filePath, bytes: stat.size };
    }

    @utcpTool(
        'writeProjectInstruction',
        'Write/overwrite a project instruction file (AGENTS.md, CLAUDE.md, etc.). Creates parent dirs. Triggers asset-db refresh if inside assets/.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path, e.g. "AGENTS.md"' },
                content: { type: 'string', description: 'Full file content to write' },
            },
            required: ['filePath', 'content'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                filePath: { type: 'string' },
                bytesWritten: { type: 'number' },
            },
            required: ['success', 'filePath'],
        },
        'POST',
        ['instruction', 'project', 'write', 'save', 'agent', 'prompt', 'AGENTS', 'CLAUDE']
    )
    async writeProjectInstruction(args: { filePath: string, content: string }): Promise<{ success: boolean, filePath: string, bytesWritten: number }> {
        const projectPath = projectPathOrThrow();
        const resolved = resolveInstructionPath(projectPath, args.filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, args.content, 'utf8');
        refreshIfAsset(projectPath, resolved);
        return { success: true, filePath: args.filePath, bytesWritten: Buffer.byteLength(args.content, 'utf8') };
    }
}
