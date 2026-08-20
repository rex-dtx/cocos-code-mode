import { existsSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { utcpTool } from '../decorators';
import { cbToPromise } from '../utils/ipc-promise';

function requireUrl(url?: string): string {
    if (!url) throw new Error('url is required');
    return url;
}

function ensureParentDir(fspath: string): void {
    const dir = dirname(fspath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function refreshDb(url: string): Promise<void> {
    return new Promise<void>((resolve) => {
        // 2.4: refresh takes url, cb optional
        try { Editor.assetdb.refresh(url, () => resolve()); }
        catch (e) { resolve(); }
    });
}

export class AssetWriteTools {

    @utcpTool(
        'assetCreateFolder',
        'Create a folder under db://assets. Intermediate folders are created.',
        {
            type: 'object',
            properties: { url: { type: 'string', description: 'Folder url, e.g. db://assets/NewFolder' } },
            required: ['url'],
        },
        { type: 'object', properties: { url: { type: 'string' }, fspath: { type: 'string' } }, required: ['url'] },
        'POST', ['asset', 'create', 'folder', 'mkdir', 'directory']
    )
    async assetCreateFolder(args: { url: string }): Promise<any> {
        const url = requireUrl(args.url);
        const fspath = Editor.assetdb.urlToFspath(url);
        if (!fspath) throw new Error('Cannot resolve fspath for ' + url);
        if (existsSync(fspath)) throw new Error('Folder already exists: ' + url);
        mkdirSync(fspath, { recursive: true });
        await refreshDb(url);
        return { url, fspath };
    }

    @utcpTool(
        'assetWriteContent',
        'Write text content to an asset file (creates if not exists). Triggers asset-db refresh.',
        {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Asset db:// url' },
                content: { type: 'string', description: 'New file content' },
            },
            required: ['url', 'content'],
        },
        { type: 'object', properties: { url: { type: 'string' }, fspath: { type: 'string' }, bytes: { type: 'number' } }, required: ['url'] },
        'POST', ['asset', 'write', 'save', 'content', 'file']
    )
    async assetWriteContent(args: { url: string, content: string }): Promise<any> {
        const url = requireUrl(args.url);
        const fspath = Editor.assetdb.urlToFspath(url);
        if (!fspath) throw new Error('Cannot resolve fspath for ' + url);
        ensureParentDir(fspath);
        writeFileSync(fspath, args.content, 'utf8');
        await refreshDb(url);
        return { url, fspath, bytes: Buffer.byteLength(args.content, 'utf8') };
    }

    @utcpTool(
        'assetMove',
        'Move/rename an asset. destUrl is the new db:// path.',
        {
            type: 'object',
            properties: {
                srcUrl: { type: 'string', description: 'Source db:// url' },
                destUrl: { type: 'string', description: 'Destination db:// url' },
            },
            required: ['srcUrl', 'destUrl'],
        },
        { type: 'object', properties: { srcUrl: { type: 'string' }, destUrl: { type: 'string' } } },
        'POST', ['asset', 'move', 'rename', 'relocate']
    )
    async assetMove(args: { srcUrl: string, destUrl: string }): Promise<any> {
        const src = requireUrl(args.srcUrl);
        const dest = requireUrl(args.destUrl);
        await cbToPromise<void>((cb) => (Editor.assetdb as any).move(src, dest, cb as any));
        return { srcUrl: src, destUrl: dest };
    }

    @utcpTool(
        'assetGetAvailableUrl',
        'Return non-colliding db:// url for desired path (appends _1 if exists).',
        {
            type: 'object',
            properties: { assetPath: { type: 'string', description: 'Desired db:// path, e.g. db://assets/NewFolder' } },
            required: ['assetPath'],
        },
        { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        'GET', ['asset', 'available', 'url', 'unique', 'collision']
    )
    async assetGetAvailableUrl(args: { assetPath: string }): Promise<any> {
        if (!args.assetPath) throw new Error('assetPath is required');
        const url = args.assetPath.startsWith('db://') ? args.assetPath : `db://${args.assetPath.replace(/^\/+/, '')}`;
        // 2.4 assetdb has no generate-available-url; do suffix loop via exists check (sync, cheap)
        if (!Editor.assetdb.exists(url)) return { url };
        const dot = url.lastIndexOf('.');
        const dir = dot > 0 ? url.slice(0, dot) : url;
        const ext = dot > 0 ? url.slice(dot) : '';
        for (let i = 1; i < 100; i++) {
            const cand = `${dir}_${i}${ext}`;
            if (!Editor.assetdb.exists(cand)) return { url: cand };
        }
        throw new Error('Could not find available url near ' + url);
    }

    @utcpTool(
        'assetDelete',
        'Delete an asset or folder by db:// url.',
        {
            type: 'object',
            properties: { url: { type: 'string', description: 'db:// url to delete' } },
            required: ['url'],
        },
        { type: 'object', properties: { url: { type: 'string' } } },
        'POST', ['asset', 'delete', 'remove', 'unlink']
    )
    async assetDelete(args: { url: string }): Promise<any> {
        const url = requireUrl(args.url);
        const fspath = Editor.assetdb.urlToFspath(url);
        // Use Editor.assetdb delete (reserved word -> bracket)
        await cbToPromise<void>((cb) => (Editor.assetdb as any)['delete']([url], cb as any));
        // fallback: fs delete if assetdb delete didn't handle it
        if (fspath && existsSync(fspath)) {
            const stat = statSync(fspath);
            if (stat.isDirectory()) {
                require('fs').rmSync(fspath, { recursive: true, force: true });
            } else {
                unlinkSync(fspath);
                const meta = fspath + '.meta';
                if (existsSync(meta)) unlinkSync(meta);
            }
            await refreshDb(url);
        }
        return { url };
    }

    @utcpTool(
        'assetSaveMeta',
        'Save asset meta (writes .meta JSON). metaJson must be a JSON string; meta object also accepted.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Asset uuid' },
                metaJson: { description: 'JSON string of the meta (JSON.stringify(meta,null,2)). Or pass raw meta object via meta' },
                meta: { description: 'Raw meta object (alternative to metaJson string)' },
            },
            required: ['uuid'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, uuid: { type: 'string' } }, required: ['success'] },
        'POST', ['asset', 'meta', 'save', 'saveMeta']
    )
    async assetSaveMeta(args: { uuid: string, metaJson?: string, meta?: any }): Promise<any> {
        if (!args.uuid) { throw new Error('uuid is required'); }
        let json: string;
        if (args.metaJson !== undefined) {
            json = typeof args.metaJson === 'string' ? args.metaJson : JSON.stringify(args.metaJson, null, 2);
            // Validate it is JSON
            try { JSON.parse(json); } catch (e: any) { throw new Error('metaJson is not valid JSON: ' + e.message); }
        } else if (args.meta !== undefined) {
            json = JSON.stringify(args.meta, null, 2);
        } else {
            throw new Error('Either metaJson (string) or meta (object) is required');
        }
        await cbToPromise<void>((cb) => (Editor.assetdb as any).saveMeta(args.uuid, json, cb as any));
        return { success: true, uuid: args.uuid };
    }

    @utcpTool(
        'assetImport',
        'Import external files (rawfiles) into db://. Results contain uuid/url/path/type per imported asset.',
        {
            type: 'object',
            properties: {
                rawfiles: { type: 'array', items: { type: 'string' }, description: 'Absolute filesystem paths to import, e.g. ["/tmp/foo.png"]' },
                destUrl: { type: 'string', description: 'Destination db:// url, e.g. db://assets/Imported' },
            },
            required: ['rawfiles', 'destUrl'],
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } }, destUrl: { type: 'string' } } },
        'POST', ['asset', 'import', 'rawfile', 'external']
    )
    async assetImport(args: { rawfiles: string[], destUrl: string }): Promise<any> {
        if (!Array.isArray(args.rawfiles) || args.rawfiles.length === 0) { throw new Error('rawfiles must be non-empty array'); }
        const destUrl = requireUrl(args.destUrl);
        const results = await cbToPromise<any[]>((cb) => (Editor.assetdb as any)['import'](args.rawfiles, destUrl, cb as any));
        return { results: results || [], destUrl };
    }

    @utcpTool(
        'assetExchangeUuid',
        'Exchange uuids of two assets (swap identity). Useful for replacing an asset while keeping references.',
        {
            type: 'object',
            properties: {
                urlA: { type: 'string', description: 'First db:// url' },
                urlB: { type: 'string', description: 'Second db:// url' },
            },
            required: ['urlA', 'urlB'],
        },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['asset', 'exchange', 'uuid', 'swap']
    )
    async assetExchangeUuid(args: { urlA: string, urlB: string }): Promise<any> {
        const urlA = requireUrl(args.urlA);
        const urlB = requireUrl(args.urlB);
        await cbToPromise<void>((cb) => (Editor.assetdb as any).exchangeUuid(urlA, urlB, cb as any));
        return { success: true };
    }

    @utcpTool(
        'assetRefresh',
        'Refresh asset-db at url and return results (command: create/delete/change/uuid-change).',
        {
            type: 'object',
            properties: { url: { type: 'string', description: 'db:// url to refresh, e.g. db://assets' } },
            required: ['url'],
        },
        { type: 'object', properties: { results: { type: 'array', items: { type: 'object' } }, url: { type: 'string' } } },
        'POST', ['asset', 'refresh', 'reload']
    )
    async assetRefresh(args: { url: string }): Promise<any> {
        const url = requireUrl(args.url);
        const results = await new Promise<any[]>((resolve) => {
            try {
                Editor.assetdb.refresh(url, ((err: any, res: any) => resolve(res || [])) as any);
            } catch { resolve([]); }
        });
        return { url, results: results || [] };
    }
}
