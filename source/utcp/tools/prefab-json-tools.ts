import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference } from '../schemas';
import fs from 'fs-extra';
import path from 'path';
import { VERBOSE_PREFAB_BYTES } from '../utils/verbose';
import { ToolError } from '../tool-error';

function normalizePrefabPath(p?: string): string {
    if (!p) return '';
    let s = p.replace(/\\/g, '/').trim();
    if (s.startsWith('db://')) return s.endsWith('/') ? s.slice(0, -1) : s;
    if (s.startsWith('/')) s = s.slice(1);
    if (s === '' || s === 'assets') return 'db://assets';
    if (s.startsWith('assets/')) { const r = 'db://' + s; return r.endsWith('/') ? r.slice(0, -1) : r; }
    return `db://assets/${s.replace(/^\/+/, '')}`;
}

async function resolvePrefab(ident: string): Promise<{ url: string, uuid: string, file: string }> {
    const isDbUrl = ident.startsWith('db://');
    const url = isDbUrl ? ident : undefined;
    const uuid = isDbUrl ? undefined : ident;

    let info: any = null;
    if (uuid) info = await Editor.Message.request('asset-db', 'query-asset-info', uuid).catch(() => null);
    else if (url) info = await Editor.Message.request('asset-db', 'query-asset-info', url).catch(() => null);
    if (!info) throw new Error(`Prefab not found: ${ident}`);

    const resolvedUrl: string | undefined = info?.url || url;
    const resolvedUuid: string | undefined = info?.uuid || uuid;
    if (!resolvedUrl || !resolvedUuid) throw new Error(`Prefab not found: ${ident}`);

    // Prefab type guard — allow only .prefab assets
    if (info && info.type !== 'cc.Prefab' && info.ext !== '.prefab' && !resolvedUrl.endsWith('.prefab')) {
        // Still allow — Cocos sometimes reports type differently, but warn via error if clearly wrong
        if (info.type && info.type !== 'cc.Prefab') {
            throw new ToolError({
                code: 'ASSET_TYPE_MISMATCH',
                message: `readPrefabJson accepts cc.Prefab; received ${info.type}.`,
                details: {
                    assetPath: resolvedUrl,
                    expectedTypes: ['cc.Prefab'],
                    actualType: info.type,
                },
                recovery: 'Use sceneSnapshot, nodeGetTree, or inspectorGet for a scene.',
            });
        }
    }

    let file: string | null = info?.file || null;
    if (!file) file = await Editor.Message.request('asset-db', 'query-path', resolvedUuid || resolvedUrl).catch(() => null);
    if (!file) throw new Error(`Cannot resolve filesystem path for prefab ${resolvedUrl}`);
    return { url: resolvedUrl, uuid: resolvedUuid!, file: file as string };
}

export class PrefabJsonTools {

    @utcpTool(
        'readPrefabJson',
        'Read the raw JSON content of a .prefab asset (via uuid or db:// path). Returns the parsed JSON string and metadata. Default 4MB; verbose=true lifts to 10MB.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'db:// path to the .prefab, alternative to reference.id' },
                verbose: { type: 'boolean', description: 'When true, lifts size cap to 10MB.' },
            },
            anyOf: [
                { required: ['reference'] },
                { required: ['assetPath'] },
            ],
        },
        {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Raw JSON text of the prefab file' },
                url: { type: 'string' },
                uuid: { type: 'string' },
                filesystemPath: { type: 'string' },
            },
            required: ['content', 'url', 'uuid'],
        },
        'GET',
        ['prefab', 'json', 'read', 'asset', 'file', 'inspect']
    )
    async readPrefabJson(args: { reference?: IInstanceReference, assetPath?: string, verbose?: boolean }): Promise<{ content: string, url: string, uuid: string, filesystemPath: string }> {
        const ident = args.reference?.id || (args.assetPath ? normalizePrefabPath(args.assetPath) : undefined);
        if (!ident) throw new Error('readPrefabJson requires reference.id or assetPath');
        const { url, uuid, file } = await resolvePrefab(ident);
        const stat = await (fs as any).stat(file).catch(() => null);
        if (!stat) throw new Error(`Prefab file not found on disk: ${file}`);
        const cap = args.verbose ? VERBOSE_PREFAB_BYTES : 4 * 1024 * 1024;
        if (stat.size > cap) throw new Error(`Prefab file too large (${stat.size} bytes, cap ${cap}). ${args.verbose ? 'Already at verbose cap (10MB).' : 'Pass verbose=true to lift to 10MB.'}`);
        const content = await (fs as any).readFile(file, 'utf8');
        // Validate JSON
        try { JSON.parse(content); } catch (e: any) { throw new Error(`Prefab JSON parse error: ${e.message}`); }
        return { content, url, uuid, filesystemPath: file };
    }

    @utcpTool(
        'editPrefabJson',
        'Overwrite the raw JSON content of a .prefab asset. Validates JSON before writing and refreshes asset-db afterwards.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'db:// path to the .prefab' },
                content: { type: 'string', description: 'New JSON text for the prefab file (must be valid JSON)' },
            },
            required: ['content'],
            anyOf: [
                { required: ['reference'] },
                { required: ['assetPath'] },
            ],
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
    async editPrefabJson(args: { reference?: IInstanceReference, assetPath?: string, content: string }): Promise<{ success: boolean, url: string, uuid: string }> {
        const ident = args.reference?.id || (args.assetPath ? normalizePrefabPath(args.assetPath) : undefined);
        if (!ident) throw new Error('editPrefabJson requires reference.id or assetPath');
        if (typeof args.content !== 'string' || !args.content.trim()) throw new Error('editPrefabJson requires non-empty content string');
        try { JSON.parse(args.content); } catch (e: any) { throw new Error(`Invalid JSON: ${e.message}`); }
        const { url, uuid, file } = await resolvePrefab(ident);
        await (fs as any).writeFile(file, args.content, 'utf8');
        try { await Editor.Message.request('asset-db', 'refresh-asset', url); } catch {}
        return { success: true, url, uuid };
    }

    @utcpTool(
        'duplicatePrefab',
        'Duplicate a prefab asset to a new db:// path (copy-asset). Fails if target already exists unless overwrite is true.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'db:// path of the source prefab' },
                targetAssetPath: { type: 'string', description: 'db:// path for the duplicated prefab' },
                overwrite: { type: 'boolean', description: 'Overwrite if target exists (default false)' },
            },
            required: ['targetAssetPath'],
            anyOf: [
                { required: ['reference'] },
                { required: ['assetPath'] },
            ],
        },
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                url: { type: 'string' },
            },
            required: ['reference'],
        },
        'POST',
        ['prefab', 'duplicate', 'copy', 'clone', 'asset']
    )
    async duplicatePrefab(args: { reference?: IInstanceReference, assetPath?: string, targetAssetPath: string, overwrite?: boolean }): Promise<{ reference: IInstanceReference, url: string }> {
        const ident = args.reference?.id || (args.assetPath ? normalizePrefabPath(args.assetPath) : undefined);
        if (!ident) throw new Error('duplicatePrefab requires reference.id or assetPath (source)');
        if (!args.targetAssetPath) throw new Error('duplicatePrefab requires targetAssetPath');
        const { url: sourceUrl } = await resolvePrefab(ident);
        const targetPath = normalizePrefabPath(args.targetAssetPath);
        if (!targetPath.endsWith('.prefab')) throw new Error('targetAssetPath must end with .prefab');

        const assetOptions: any = { overwrite: !!args.overwrite, rename: false };
        const result: any = await Editor.Message.request('asset-db', 'copy-asset', sourceUrl, targetPath, assetOptions);
        if (!result) throw new Error(`Failed to duplicate prefab ${sourceUrl} → ${targetPath}`);
        return { reference: { id: result.uuid, type: result.type || 'cc.Prefab' }, url: result.url || targetPath };
    }
}
