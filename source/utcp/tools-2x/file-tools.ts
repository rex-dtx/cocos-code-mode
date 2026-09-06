import fs from 'fs';
import path from 'path';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { isPathInside } from '../execute/path-safety';

const MAX_FILE_BYTES = 512 * 1024;
const VERBOSE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 100;
const VERBOSE_SEARCH_LIMIT = 1000;
const DEFAULT_DIRECTORY_ENTRIES = 200;
const MAX_DIRECTORY_ENTRIES = 1000;

function projectPathOrThrow(): string {
    const projectPath = (Editor.Project as any)?.path;
    if (typeof projectPath !== 'string' || !projectPath) {
        throw new ToolError({
            code: 'PROJECT_PATH_UNAVAILABLE',
            status: 500,
            message: 'Editor.Project.path is not available.',
            recovery: 'Open a Cocos project in Creator 2.4 before reading project files.',
        });
    }
    return projectPath;
}

function resolveSafePath(projectPath: string, relPath: string): string {
    const resolved = path.resolve(projectPath, relPath || '.');
    if (!isPathInside(projectPath, resolved)) {
        throw new ToolError({
            code: 'PATH_ESCAPES_PROJECT',
            status: 400,
            message: `Path escapes project boundary: ${relPath}`,
            recovery: 'Pass a project-relative path such as assets/scripts/Game.js.',
        });
    }
    return resolved;
}

function refreshIfAsset(projectPath: string, resolved: string): void {
    const relToProject = path.relative(projectPath, resolved).replace(/\\/g, '/');
    if (!relToProject.startsWith('assets/') && relToProject !== 'assets') {
        return;
    }
    try {
        Editor.assetdb.refresh(`db://${relToProject}`, (() => { /* fire-and-forget */ }) as any);
    } catch {
        // Write itself succeeded; asset-db reimport is owned by the editor.
    }
}

function boundedPositive(value: unknown, fallback: number, maximum: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(value, maximum)
        : fallback;
}

export class FileTools {

    @utcpTool(
        'projectReadFile',
        'Read a text file from the project directory. Default 512KB; verbose=true lifts to 10MB.',
        {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'Project-relative path, e.g. "assets/scripts/Game.js"' },
                verbose: { type: 'boolean', description: 'When true, lifts size cap to 10MB.' },
            },
            required: ['filePath'],
        },
        { type: 'object', properties: { content: { type: 'string' }, bytes: { type: 'number' } }, required: ['content'] },
        'GET',
        ['file', 'read', 'project', 'script', 'text']
    )
    async projectReadFile(args: { filePath: string, verbose?: boolean }): Promise<{ content: string, bytes: number }> {
        const projectPath = projectPathOrThrow();
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) {
            throw new ToolError({
                code: 'FILE_NOT_FOUND',
                status: 404,
                message: `File not found: ${args.filePath}`,
                recovery: 'Use projectFileExists or projectListDirectory to locate the path.',
            });
        }
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
            throw new ToolError({
                code: 'NOT_A_FILE',
                status: 422,
                message: `Path is a directory: ${args.filePath}`,
                recovery: 'Use projectListDirectory for folders.',
            });
        }
        const cap = args.verbose ? VERBOSE_FILE_BYTES : MAX_FILE_BYTES;
        if (stat.size > cap) {
            throw new ToolError({
                code: 'FILE_TOO_LARGE',
                status: 422,
                message: `File too large (${stat.size} bytes, cap ${cap}).`,
                recovery: args.verbose ? 'Already at verbose cap (10MB). Read a smaller file.' : 'Pass verbose=true to lift to 10MB.',
            });
        }
        const content = fs.readFileSync(resolved, 'utf8');
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
        const projectPath = projectPathOrThrow();
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (args.createDirs !== false) {
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
        }
        fs.writeFileSync(resolved, args.content, 'utf8');
        refreshIfAsset(projectPath, resolved);
        return { success: true, bytesWritten: Buffer.byteLength(args.content, 'utf8') };
    }

    @utcpTool(
        'projectSearchFiles',
        'Search project files by glob-like pattern (* and **). Default 100 results; verbose=true lifts to 1000.',
        {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob pattern, e.g. "assets/**/*.js" or "*.json"' },
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
        const projectPath = projectPathOrThrow();
        const limit = args.verbose
            ? Math.max(1, Math.min(args.limit ?? VERBOSE_SEARCH_LIMIT, VERBOSE_SEARCH_LIMIT))
            : Math.max(1, Math.min(args.limit ?? MAX_SEARCH_RESULTS, 500));
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
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'library' || entry.name === 'temp' || entry.name === 'local') continue;
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
        const projectPath = projectPathOrThrow();
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) {
            throw new ToolError({
                code: 'FILE_NOT_FOUND',
                status: 404,
                message: `File not found: ${args.filePath}`,
                recovery: 'Use projectFileExists to confirm the path.',
            });
        }
        const content = fs.readFileSync(resolved, 'utf8');
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
        fs.writeFileSync(resolved, newContent, 'utf8');
        refreshIfAsset(projectPath, resolved);
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
        const projectPath = projectPathOrThrow();
        const resolved = resolveSafePath(projectPath, args.filePath);
        if (!fs.existsSync(resolved)) return { exists: false, isDirectory: false };
        return { exists: true, isDirectory: fs.statSync(resolved).isDirectory() };
    }

    @utcpTool(
        'projectListDirectory',
        'List files and directories in a project directory. Default 200 entries, 1000 max.',
        {
            type: 'object',
            properties: {
                dirPath: { type: 'string', description: 'Project-relative directory path (default ".")' },
                limit: { type: 'number', description: 'Max entries (default 200, max 1000)' },
            },
        },
        {
            type: 'object',
            properties: {
                entries: { type: 'array', items: { type: 'object' } },
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
            required: ['entries', 'total', 'truncated'],
        },
        'GET',
        ['file', 'list', 'directory', 'folder', 'project']
    )
    async projectListDirectory(args: { dirPath?: string, limit?: number } = {}): Promise<{ entries: { name: string, type: 'file' | 'directory', size?: number }[], total: number, truncated: boolean }> {
        const projectPath = projectPathOrThrow();
        const resolved = resolveSafePath(projectPath, args.dirPath || '.');
        if (!fs.existsSync(resolved)) {
            throw new ToolError({
                code: 'DIRECTORY_NOT_FOUND',
                status: 404,
                message: `Directory not found: ${args.dirPath || '.'}`,
                recovery: 'Use projectFileExists to confirm the folder.',
            });
        }
        const allEntries = fs.readdirSync(resolved, { withFileTypes: true });
        const total = allEntries.length;
        const limit = boundedPositive(args.limit, DEFAULT_DIRECTORY_ENTRIES, MAX_DIRECTORY_ENTRIES);
        const entries = allEntries.slice(0, limit).map((entry) => {
            const fullPath = path.join(resolved, entry.name);
            let size: number | undefined;
            try {
                if (entry.isFile()) size = fs.statSync(fullPath).size;
            } catch { /* skip unreadable */ }
            return {
                name: entry.name,
                type: (entry.isDirectory() ? 'directory' : 'file') as 'file' | 'directory',
                size,
            };
        });
        return { entries, total, truncated: total > entries.length };
    }
}
