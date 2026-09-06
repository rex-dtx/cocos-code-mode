import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { cbToPromise } from '../utils/ipc-promise';

const DEFAULT_CAP = 4 * 1024 * 1024;
const VERBOSE_CAP = 10 * 1024 * 1024;

function normalizePrefabPath(p?: string): string {
    if (!p) return '';
    let s = p.replace(/\\/g, '/').trim();
    if (s.startsWith('db://')) return s.endsWith('/') ? s.slice(0, -1) : s;
    if (s.startsWith('/')) s = s.slice(1);
    if (s === '' || s === 'assets') return 'db://assets';
    if (s.startsWith('assets/')) {
        const r = 'db://' + s;
        return r.endsWith('/') ? r.slice(0, -1) : r;
    }
    return `db://assets/${s.replace(/^\/+/, '')}`;
}

function resolvePrefab(ident: string): { url: string, uuid: string, file: string } {
    const isDbUrl = ident.startsWith('db://');
    const uuid = isDbUrl ? Editor.assetdb.urlToUuid(ident) : ident;
    const url = isDbUrl ? ident : Editor.assetdb.uuidToUrl(ident);
    if (!uuid || !url) {
        throw new ToolError({
            code: 'PREFAB_NOT_FOUND',
            status: 404,
            message: `Prefab not found: ${ident}`,
            recovery: 'Pass a .prefab uuid or db:// path from assetQuery.',
        });
    }
    const info = Editor.assetdb.assetInfoByUuid(uuid);
    const resolvedUrl = (info && (info as any).url) || url;
    if (info && (info as any).type && (info as any).type !== 'cc.Prefab' && !(resolvedUrl || '').endsWith('.prefab')) {
        throw new ToolError({
            code: 'ASSET_TYPE_MISMATCH',
            status: 422,
            message: `readPrefabJson accepts cc.Prefab; received ${(info as any).type}.`,
            details: { expectedTypes: ['cc.Prefab'], actualType: (info as any).type },
            recovery: 'Use nodeQuery or sceneSnapshot for a scene (.fire).',
        });
    }
    if (!(resolvedUrl || '').endsWith('.prefab')) {
        throw new ToolError({
            code: 'ASSET_TYPE_MISMATCH',
            status: 422,
            message: `Not a .prefab asset: ${resolvedUrl}`,
            recovery: 'Pass a path ending in .prefab.',
        });
    }
    const file = Editor.assetdb.uuidToFspath(uuid) || Editor.assetdb.urlToFspath(resolvedUrl);
    if (!file) {
        throw new ToolError({
            code: 'PREFAB_PATH_UNRESOLVED',
            status: 404,
            message: `Cannot resolve filesystem path for prefab ${resolvedUrl}`,
            recovery: 'Refresh asset-db then retry.',
        });
    }
    return { url: resolvedUrl, uuid, file };
}

export class PrefabJsonTools {

    @utcpTool(
        'readPrefabJson',
        'Read the raw JSON content of a .prefab asset (via uuid or db:// path). Default 4MB; verbose=true lifts to 10MB.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Prefab asset uuid' },
                assetPath: { type: 'string', description: 'db:// path to the .prefab' },
                verbose: { type: 'boolean', description: 'When true, lifts size cap to 10MB.' },
            },
        },
        {
            type: 'object',
            properties: {
                content: { type: 'string' },
                url: { type: 'string' },
                uuid: { type: 'string' },
                filesystemPath: { type: 'string' },
            },
            required: ['content', 'url', 'uuid'],
        },
        'GET',
        ['prefab', 'json', 'read', 'asset', 'file', 'inspect']
    )
    async readPrefabJson(args: { uuid?: string, assetPath?: string, verbose?: boolean }): Promise<{ content: string, url: string, uuid: string, filesystemPath: string }> {
        const ident = args.uuid || (args.assetPath ? normalizePrefabPath(args.assetPath) : '');
        if (!ident) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'readPrefabJson requires uuid or assetPath',
                recovery: 'Pass uuid from assetQuery or a db://assets/...prefab path.',
            });
        }
        const { url, uuid, file } = resolvePrefab(ident);
        if (!existsSync(file)) {
            throw new ToolError({
                code: 'FILE_NOT_FOUND',
                status: 404,
                message: `Prefab file not found on disk: ${file}`,
                recovery: 'Refresh asset-db or reimport the prefab.',
            });
        }
        const stat = statSync(file);
        const cap = args.verbose ? VERBOSE_CAP : DEFAULT_CAP;
        if (stat.size > cap) {
            throw new ToolError({
                code: 'FILE_TOO_LARGE',
                status: 422,
                message: `Prefab file too large (${stat.size} bytes, cap ${cap}).`,
                recovery: args.verbose ? 'Already at verbose cap (10MB).' : 'Pass verbose=true to lift to 10MB.',
            });
        }
        const content = readFileSync(file, 'utf8');
        try { JSON.parse(content); } catch (e: any) {
            throw new ToolError({
                code: 'INVALID_JSON',
                status: 422,
                message: `Prefab JSON parse error: ${e && e.message}`,
                recovery: 'Open the .prefab in a text editor and fix JSON syntax.',
            });
        }
        return { content, url, uuid, filesystemPath: file };
    }

    @utcpTool(
        'editPrefabJson',
        'Overwrite the raw JSON content of a .prefab asset. Validates JSON before writing and refreshes asset-db afterwards.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Prefab asset uuid' },
                assetPath: { type: 'string', description: 'db:// path to the .prefab' },
                content: { type: 'string', description: 'New JSON text (must be valid JSON)' },
            },
            required: ['content'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                url: { type: 'string' },
                uuid: { type: 'string' },
            },
            required: ['success'],
        },
        'POST',
        ['prefab', 'json', 'edit', 'write', 'asset', 'save']
    )
    async editPrefabJson(args: { uuid?: string, assetPath?: string, content: string }): Promise<{ success: boolean, url: string, uuid: string }> {
        const ident = args.uuid || (args.assetPath ? normalizePrefabPath(args.assetPath) : '');
        if (!ident) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'editPrefabJson requires uuid or assetPath',
                recovery: 'Pass uuid or db:// path of the source prefab.',
            });
        }
        if (typeof args.content !== 'string' || !args.content.trim()) {
            throw new ToolError({
                code: 'INVALID_INPUT',
                status: 400,
                message: 'editPrefabJson requires non-empty content string',
                recovery: 'Pass the full prefab JSON text.',
            });
        }
        try { JSON.parse(args.content); } catch (e: any) {
            throw new ToolError({
                code: 'INVALID_JSON',
                status: 422,
                message: `Invalid JSON: ${e && e.message}`,
                recovery: 'Validate the JSON before writing.',
            });
        }
        const { url, uuid, file } = resolvePrefab(ident);
        writeFileSync(file, args.content, 'utf8');
        try {
            Editor.assetdb.refresh(url, (() => { /* fire-and-forget */ }) as any);
        } catch { /* write itself succeeded */ }
        return { success: true, url, uuid };
    }

    @utcpTool(
        'duplicatePrefab',
        'Duplicate a prefab asset to a new db:// path. Fails if target exists unless overwrite is true.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Source prefab uuid' },
                assetPath: { type: 'string', description: 'Source db:// path' },
                targetAssetPath: { type: 'string', description: 'db:// path for the duplicate' },
                overwrite: { type: 'boolean', description: 'Overwrite if target exists (default false)' },
            },
            required: ['targetAssetPath'],
        },
        {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string' },
            },
            required: ['uuid'],
        },
        'POST',
        ['prefab', 'duplicate', 'copy', 'clone', 'asset']
    )
    async duplicatePrefab(args: { uuid?: string, assetPath?: string, targetAssetPath: string, overwrite?: boolean }): Promise<{ uuid: string, url: string }> {
        const ident = args.uuid || (args.assetPath ? normalizePrefabPath(args.assetPath) : '');
        if (!ident) {
            throw new ToolError({
                code: 'MISSING_INPUTS',
                status: 400,
                message: 'duplicatePrefab requires uuid or assetPath (source)',
                recovery: 'Pass the source prefab uuid or db:// path.',
            });
        }
        const { url: sourceUrl } = resolvePrefab(ident);
        const targetPath = normalizePrefabPath(args.targetAssetPath);
        if (!targetPath.endsWith('.prefab')) {
            throw new ToolError({
                code: 'INVALID_INPUT',
                status: 400,
                message: 'targetAssetPath must end with .prefab',
                recovery: 'Use a path like db://assets/foo.prefab.',
            });
        }
        const destExists = !!Editor.assetdb.urlToUuid(targetPath);
        if (destExists && !args.overwrite) {
            throw new ToolError({
                code: 'TARGET_EXISTS',
                status: 422,
                message: `Target already exists: ${targetPath}`,
                recovery: 'Pass overwrite=true or pick a free path via assetGetAvailableUrl.',
            });
        }
        if (destExists && args.overwrite) {
            await cbToPromise<void>((cb) => (Editor.assetdb as any).delete(targetPath, cb as any));
        }
        await cbToPromise<void>((cb) => (Editor.assetdb as any).copy(sourceUrl, targetPath, cb as any));
        const newUuid = Editor.assetdb.urlToUuid(targetPath);
        if (!newUuid) {
            throw new ToolError({
                code: 'DUPLICATE_FAILED',
                status: 500,
                message: `Failed to duplicate prefab ${sourceUrl} → ${targetPath}`,
                recovery: 'Check asset-db copy permissions and retry.',
            });
        }
        return { uuid: newUuid, url: targetPath };
    }
}
