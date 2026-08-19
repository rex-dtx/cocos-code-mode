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
        'Return a non-colliding db:// url for the given desired path (appends _1 suffix if exists). Use before create to avoid overwrite.',
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
}
