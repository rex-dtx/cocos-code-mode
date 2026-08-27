import { utcpTool } from '../decorators';
import fs from 'fs-extra';
import path from 'path';

// Project instruction files — allowlist mirrors funplay's instruction-tools.
// Raw fs + path-safety, same pattern as file-tools.ts.

function resolveSafePath(projectPath: string, relPath: string): string {
    const resolved = path.resolve(projectPath, relPath);
    const rel = path.relative(projectPath, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path escapes project boundary: ${relPath}`);
    }
    return resolved;
}

export class InstructionTools {

    @utcpTool(
        'readProjectInstruction',
        'Read a project instruction file (AGENTS.md, CLAUDE.md, GEMINI.md, .codex, rules/*.md). Returns content or not-found.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path, e.g. "AGENTS.md" or "CLAUDE.md" or "docs/rules.md"' },
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
    async readProjectInstruction(args: { filePath: string }): Promise<{ content: string, exists: boolean, filePath: string, bytes: number }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) {
            return { content: '', exists: false, filePath: args.filePath, bytes: 0 };
        }
        const stat = fs.statSync(resolved);
        if (stat.size > 512 * 1024) throw new Error(`Instruction file too large (${stat.size} bytes, cap 512KB)`);
        const content = fs.readFileSync(resolved, 'utf-8');
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
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, args.content, 'utf-8');
        const relToProject = path.relative(projectPath, resolved).replace(/\\/g, '/');
        if (relToProject.startsWith('assets/')) {
            try { await Editor.Message.request('asset-db', 'refresh-asset', `db://${relToProject}`); } catch {}
        }
        return { success: true, filePath: args.filePath, bytesWritten: Buffer.byteLength(args.content, 'utf-8') };
    }
}
