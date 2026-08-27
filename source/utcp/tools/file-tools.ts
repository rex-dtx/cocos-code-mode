import { utcpTool } from '../decorators';
import fs from 'fs-extra';
import path from 'path';
import { VERBOSE_FILE_BYTES, VERBOSE_SEARCH_LIMIT } from '../utils/verbose';

const MAX_FILE_BYTES = 512 * 1024; // 512KB read cap
const MAX_SEARCH_RESULTS = 100;

function resolveSafePath(projectPath: string, relPath: string): string {
    const resolved = path.resolve(projectPath, relPath);
    const rel = path.relative(projectPath, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path escapes project boundary: ${relPath}`);
    }
    return resolved;
}

export class FileTools {

    @utcpTool(
        'projectReadFile',
        'Read a text file from the project directory. Returns content string. Default 512KB; verbose=true lifts to 10MB.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path, e.g. "assets/scripts/Game.ts"' },
                verbose: { type: 'boolean', description: 'When true, lifts size cap to 10MB.' },
            },
            required: ['filePath'],
        },
        { type: 'object', properties: { content: { type: 'string' }, bytes: { type: 'number' } }, required: ['content'] },
        'GET',
        ['file', 'read', 'project', 'script', 'text']
    )
    async projectReadFile(args: { filePath: string, verbose?: boolean }): Promise<{ content: string, bytes: number }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${args.filePath}`);
        const stat = fs.statSync(resolved);
        const cap = args.verbose ? VERBOSE_FILE_BYTES : MAX_FILE_BYTES;
        if (stat.size > cap) throw new Error(`File too large (${stat.size} bytes, cap ${cap}). ${args.verbose ? 'Already at verbose cap (10MB).' : 'Pass verbose=true to lift to 10MB.'} Read a smaller portion.`);
        const content = fs.readFileSync(resolved, 'utf-8');
        return { content, bytes: stat.size };
    }

    @utcpTool(
        'projectWriteFile',
        'Write/overwrite a text file in the project. Triggers asset-db refresh if inside assets/.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path' },
                content: { type: 'string', description: 'File content to write' },
                createDirs: { type: 'boolean', description: 'Create parent directories if missing (default true)' },
            },
            required: ['filePath', 'content'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, bytesWritten: { type: 'number' } }, required: ['success'] },
        'POST',
        ['file', 'write', 'project', 'script', 'save', 'create']
    )
    async projectWriteFile(args: { filePath: string, content: string, createDirs?: boolean }): Promise<{ success: boolean, bytesWritten: number }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);

        if (args.createDirs !== false) {
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
        }
        fs.writeFileSync(resolved, args.content, 'utf-8');

        // Refresh asset-db if file is inside assets/
        const relToProject = path.relative(projectPath, resolved).replace(/\\/g, '/');
        if (relToProject.startsWith('assets/')) {
            const dbUrl = `db://${relToProject}`;
            try { await Editor.Message.request('asset-db', 'refresh-asset', dbUrl); } catch {}
        }

        return { success: true, bytesWritten: Buffer.byteLength(args.content, 'utf-8') };
    }

    @utcpTool(
        'projectSearchFiles',
        'Search project files by glob-like pattern (supports * wildcard). Returns matching relative paths. Default 100 results; verbose=true lifts to 1000.',
        {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob pattern, e.g. "assets/**/*.ts" or "*.json"' },
                limit: { type: 'number', description: 'Max results (default 100)' },
                verbose: { type: 'boolean', description: 'When true, lifts default to 1000 results.' },
            },
            required: ['pattern'],
        },
        { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, total: { type: 'number' } }, required: ['files', 'total'] },
        'GET',
        ['file', 'search', 'find', 'glob', 'pattern', 'project']
    )
    async projectSearchFiles(args: { pattern: string, limit?: number, verbose?: boolean }): Promise<{ files: string[], total: number }> {
        const projectPath = (Editor.Project as any).path as string;
        const limit = args.verbose
            ? Math.max(1, Math.min(args.limit ?? VERBOSE_SEARCH_LIMIT, VERBOSE_SEARCH_LIMIT))
            : Math.max(1, Math.min(args.limit ?? MAX_SEARCH_RESULTS, 500));

        // Convert glob to regex: * = any chars except /, ** = any chars including /
        const regexStr = args.pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<GLOBSTAR>>>/g, '.*');
        const regex = new RegExp(`^${regexStr}$`, 'i');

        const results: string[] = [];
        const walk = (dir: string) => {
            if (results.length >= limit) return;
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                if (results.length >= limit) return;
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'library' || entry.name === 'temp') continue;
                const fullPath = path.join(dir, entry.name);
                const relPath = path.relative(projectPath, fullPath).replace(/\\/g, '/');
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (regex.test(relPath)) {
                    results.push(relPath);
                }
            }
        };
        walk(projectPath);
        return { files: results, total: results.length };
    }

    @utcpTool(
        'projectReplaceInFile',
        'Search and replace text in a project file. Returns replacement count.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path' },
                search: { type: 'string', description: 'Literal text to find' },
                replace: { type: 'string', description: 'Replacement text' },
                replaceAll: { type: 'boolean', description: 'Replace all occurrences (default true)' },
            },
            required: ['filePath', 'search', 'replace'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, replacements: { type: 'number' } }, required: ['success', 'replacements'] },
        'POST',
        ['file', 'replace', 'edit', 'refactor', 'project']
    )
    async projectReplaceInFile(args: { filePath: string, search: string, replace: string, replaceAll?: boolean }): Promise<{ success: boolean, replacements: number }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${args.filePath}`);

        const content = fs.readFileSync(resolved, 'utf-8');
        const replaceAll = args.replaceAll !== false;

        let newContent: string;
        let count = 0;
        if (replaceAll) {
            const parts = content.split(args.search);
            count = parts.length - 1;
            newContent = parts.join(args.replace);
        } else {
            const idx = content.indexOf(args.search);
            if (idx === -1) return { success: false, replacements: 0 };
            newContent = content.slice(0, idx) + args.replace + content.slice(idx + args.search.length);
            count = 1;
        }

        if (count === 0) return { success: false, replacements: 0 };
        fs.writeFileSync(resolved, newContent, 'utf-8');

        // Refresh asset-db if inside assets/
        const relToProject = path.relative(projectPath, resolved).replace(/\\/g, '/');
        if (relToProject.startsWith('assets/')) {
            try { await Editor.Message.request('asset-db', 'refresh-asset', `db://${relToProject}`); } catch {}
        }

        return { success: true, replacements: count };
    }

    @utcpTool(
        'projectFileExists',
        'Check whether a file or directory exists in the project.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path' },
            },
            required: ['filePath'],
        },
        { type: 'object', properties: { exists: { type: 'boolean' }, isDirectory: { type: 'boolean' } }, required: ['exists'] },
        'GET',
        ['file', 'exists', 'check', 'project']
    )
    async projectFileExists(args: { filePath: string }): Promise<{ exists: boolean, isDirectory: boolean }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) return { exists: false, isDirectory: false };
        const stat = fs.statSync(resolved);
        return { exists: true, isDirectory: stat.isDirectory() };
    }

    @utcpTool(
        'projectListDirectory',
        'List files and directories in a project directory.',
        {
            type: 'object',
            properties: {
                dirPath: { type: 'string', description: 'Project-relative directory path (default ".")' },
            },
        },
        { type: 'object', properties: { entries: { type: 'array', items: { type: 'object' } } }, required: ['entries'] },
        'GET',
        ['file', 'list', 'directory', 'folder', 'project']
    )
    async projectListDirectory(args: { dirPath?: string }): Promise<{ entries: { name: string, type: 'file' | 'directory', size?: number }[] }> {
        const projectPath = (Editor.Project as any).path as string;
        const resolved = resolveSafePath(projectPath, args.dirPath || '.');
        if (!fs.existsSync(resolved)) throw new Error(`Directory not found: ${args.dirPath || '.'}`);

        const entries = fs.readdirSync(resolved, { withFileTypes: true }).map(entry => {
            const fullPath = path.join(resolved, entry.name);
            const stat = fs.statSync(fullPath);
            return {
                name: entry.name,
                type: (entry.isDirectory() ? 'directory' : 'file') as 'file' | 'directory',
                size: entry.isFile() ? stat.size : undefined,
            };
        });
        return { entries };
    }
}
