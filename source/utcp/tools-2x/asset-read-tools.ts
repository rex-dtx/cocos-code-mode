import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';
import { utcpTool } from '../decorators';
import { cbToPromise, sceneScript } from '../utils/ipc-promise';

// Text extension cho phep doc. Ngoai list -> throw (dung do binary vao context agent).
const READABLE_EXTENSIONS = ['.ts', '.js', '.json', '.fire', '.prefab', '.anim', '.effect', '.txt', '.md', '.yaml', '.yml', '.plist', '.atlas'];
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_SEARCH_LIMIT = 200;
const DEFAULT_TREE_DEPTH = 5;
const DEFAULT_USED_BY_LIMIT = 200;

function requireUrl(args: { url?: string }): string {
    if (!args.url) { throw new Error('url is required for this operation'); }
    return args.url;
}

function requireUuid(args: { uuid?: string }): string {
    if (!args.uuid) { throw new Error('uuid is required for this operation'); }
    return args.uuid;
}

/** Nhieu op nhan url XOR uuid — chuan hoa ve fspath mot cho. */
function resolveFspath(args: { url?: string, uuid?: string }): string {
    const fspath = args.uuid
        ? Editor.assetdb.uuidToFspath(args.uuid)
        : args.url ? Editor.assetdb.urlToFspath(args.url) : null;
    if (!fspath) {
        throw new Error(`Cannot resolve filesystem path from ${args.uuid ? `uuid ${args.uuid}` : `url ${args.url}`}`);
    }
    return fspath;
}

/**
 * deepQuery tra FLAT list co parentUuid (docs asset-db-main.md khai `children` — SAI voi 2.4.15,
 * verify runtime: key that la uuid/parentUuid/name/extname/type/isSubAsset/hidden/readonly).
 * Dung cay tu parentUuid, cat theo depth, bao childrenCount cho nhanh bi cat.
 */
function buildTree(flat: IDeepQueryResult2x[], maxDepth: number): any[] {
    const byParent = new Map<string, IDeepQueryResult2x[]>();
    const known = new Set(flat.map((n) => n.uuid));
    for (const node of flat) {
        // Node co parentUuid ngoai tap ket qua -> coi nhu root (mount khong co parent).
        const parent = node.parentUuid && known.has(node.parentUuid) ? node.parentUuid : '';
        const bucket = byParent.get(parent);
        if (bucket) { bucket.push(node); } else { byParent.set(parent, [node]); }
    }

    const walk = (parentUuid: string, depth: number): any[] =>
        (byParent.get(parentUuid) || []).map((node) => {
            const children = byParent.get(node.uuid) || [];
            const base = {
                name: node.name,
                extname: node.extname,
                uuid: node.uuid,
                type: node.type,
                isSubAsset: node.isSubAsset,
                childrenCount: children.length,
            };
            if (children.length === 0) { return base; }
            if (depth >= maxDepth) { return { ...base, truncated: true }; }
            return { ...base, children: walk(node.uuid, depth + 1) };
        });

    return walk('', 0);
}

/** assetTypes accept CSV string OR array. Return array or null (=all types). */
function normalizeTypes(assetTypes: string | string[] | undefined): string[] | null {
    if (!assetTypes) { return null; }
    if (Array.isArray(assetTypes)) {
        const clean = assetTypes.map((t) => String(t).trim()).filter((t) => t.length > 0);
        return clean.length ? clean : null;
    }
    const clean = String(assetTypes).split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    return clean.length ? clean : null;
}

/** Meta instance from queryMetas can carry circular refs -> safe JSON round-trip. */
function safeSerialize(value: any): any {
    const seen = new WeakSet();
    try {
        return JSON.parse(JSON.stringify(value, (_k, v) => {
            if (v && typeof v === 'object') {
                if (seen.has(v)) { return '[circular]'; }
                seen.add(v);
            }
            return v;
        }));
    } catch {
        return null;
    }
}

export class AssetReadTools {

    @utcpTool(
        'assetResolve',
        'Convert asset url/uuid/path or check existence (sync asset db lookup). Also: mount/relative/backup helpers.',
        {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: [
                        'uuid_from_url', 'url_from_uuid', 'fspath', 'exists',
                        'exists_by_path', 'is_sub_asset', 'contains_sub_assets',
                        'mount_info', 'relative_path', 'backup_path',
                    ],
                    description: 'Which conversion to perform'
                },
                url: { type: 'string', description: 'Asset url, e.g. db://assets/Scene/helloworld.fire' },
                uuid: { type: 'string', description: 'Asset uuid' },
                fspath: { type: 'string', description: 'Absolute filesystem path (for exists_by_path / is_sub_asset / mount_info / relative_path / backup_path)' },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                uuid: { type: 'string' },
                url: { type: 'string' },
                fspath: { type: 'string' },
                exists: { type: 'boolean' },
                isSubAsset: { type: 'boolean' },
                containsSubAssets: { type: 'boolean' },
                mountInfo: { type: 'object' },
                relativePath: { type: 'string' },
                backupPath: { type: 'string' },
            },
        },
        'GET', ['asset', 'uuid', 'url', 'path', 'resolve', 'exists', 'mount', 'relative', 'backup', 'subasset']
    )
    async assetResolve(args: { operation: string, url?: string, uuid?: string, fspath?: string }): Promise<any> {
        switch (args.operation) {
            case 'uuid_from_url':
                return { uuid: Editor.assetdb.urlToUuid(requireUrl(args)) || undefined };
            case 'url_from_uuid':
                return { url: Editor.assetdb.uuidToUrl(requireUuid(args)) || undefined };
            case 'fspath':
                return { fspath: resolveFspath(args) };
            case 'exists':
                if (args.uuid) { return { exists: Editor.assetdb.existsByUuid(args.uuid) }; }
                return { exists: Editor.assetdb.exists(requireUrl(args)) };
            case 'exists_by_path': {
                if (!args.fspath) { throw new Error('fspath is required for exists_by_path'); }
                return { exists: (Editor.assetdb as any).existsByPath(args.fspath) };
            }
            case 'is_sub_asset': {
                if (args.fspath) { return { isSubAsset: (Editor.assetdb as any).isSubAssetByPath(args.fspath) }; }
                if (args.uuid) { return { isSubAsset: (Editor.assetdb as any).isSubAssetByUuid(args.uuid) }; }
                return { isSubAsset: (Editor.assetdb as any).isSubAsset(requireUrl(args)) };
            }
            case 'contains_sub_assets': {
                if (args.fspath) { return { containsSubAssets: (Editor.assetdb as any).containsSubAssetsByPath(args.fspath) }; }
                if (args.uuid) { return { containsSubAssets: (Editor.assetdb as any).containsSubAssetsByUuid(args.uuid) }; }
                return { containsSubAssets: (Editor.assetdb as any).containsSubAssets(requireUrl(args)) };
            }
            case 'mount_info': {
                let info: any = null;
                try {
                    if (args.fspath) { info = (Editor.assetdb as any).mountInfoByPath(args.fspath); }
                    else if (args.uuid) { info = (Editor.assetdb as any).mountInfoByUuid(args.uuid); }
                    else { info = (Editor.assetdb as any).mountInfo(requireUrl(args)); }
                } catch {}
                return { mountInfo: info || null };
            }
            case 'relative_path': {
                const p = args.fspath || resolveFspath(args);
                return { relativePath: (Editor.assetdb as any).getRelativePath(p) };
            }
            case 'backup_path': {
                const p = args.fspath || resolveFspath(args);
                return { backupPath: (Editor.assetdb as any).getAssetBackupPath(p) };
            }
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'assetQuery',
        'Query asset db: search, tree, info, meta, types, sub_assets, used_by, metas.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['search', 'tree', 'info', 'meta', 'types', 'sub_assets', 'used_by', 'metas'], description: 'Which query to run' },
                pattern: { type: 'string', description: 'Glob for search, default db://assets/**/*' },
                assetTypes: { description: 'Comma-separated type names OR array, e.g. texture,scene OR ["texture","scene"]. Omit for all types' },
                url: { type: 'string', description: 'Asset url — for info / meta / sub_assets / used_by' },
                uuid: { type: 'string', description: 'Asset uuid — for info / meta / sub_assets / used_by' },
                limit: { type: 'number', description: `Max results for search, default ${DEFAULT_SEARCH_LIMIT}` },
                maxDepth: { type: 'number', description: `Max tree depth, default ${DEFAULT_TREE_DEPTH}` },
                maxResults: { type: 'number', description: `Max results for used_by, default ${DEFAULT_USED_BY_LIMIT}` },
                // metas-only
                type: { type: 'string', description: 'Importer/type name for metas (e.g. texture), filter passed to queryMetas' },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                assets: { type: 'array', items: { type: 'object' } },
                tree: { type: 'array', items: { type: 'object' } },
                info: { type: 'object' },
                meta: { type: 'object' },
                metaPath: { type: 'string' },
                metaMtime: { type: 'number' },
                types: { type: 'array', items: { type: 'string' } },
                nodes: { type: 'array', items: { type: 'object' } },
                metas: { type: 'array', items: { type: 'object' } },
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
        },
        'GET', ['asset', 'search', 'tree', 'meta', 'info', 'types', 'query', 'used_by', 'reverse', 'reference', 'metas']
    )
    async assetQuery(args: { operation: string, pattern?: string, assetTypes?: any, url?: string, uuid?: string, limit?: number, maxDepth?: number, maxResults?: number, type?: string }): Promise<any> {
        switch (args.operation) {
            case 'search': {
                const pattern = args.pattern || 'db://assets/**/*';
                // assetTypes null = moi type (verify runtime — Unresolved phase 4).
                const types = normalizeTypes(args.assetTypes as any);
                const found = await cbToPromise<IQueryAssetResult2x[]>((cb) => Editor.assetdb.queryAssets(pattern, types as any, cb));
                const limit = args.limit || DEFAULT_SEARCH_LIMIT;
                return { assets: found.slice(0, limit), total: found.length, truncated: found.length > limit };
            }
            case 'tree': {
                const flat = await cbToPromise<IDeepQueryResult2x[]>((cb) => Editor.assetdb.deepQuery(cb));
                return { tree: buildTree(flat, args.maxDepth || DEFAULT_TREE_DEPTH), total: flat.length };
            }
            case 'info': {
                const info = args.uuid ? Editor.assetdb.assetInfoByUuid(args.uuid) : Editor.assetdb.assetInfo(requireUrl(args));
                if (!info) { throw new Error(`Asset not found: ${args.uuid || args.url}`); }
                return { info };
            }
            case 'meta': {
                // loadMeta*() tra LIVE object co circular ref (_uuid2meta -> asset-db) -> res.json() no.
                // Doc thang file .meta canh asset: cung nguon du lieu, JSON thuan, kem mtime.
                // ponytail: fs.readFile thay vi tim API dump — docs 2.4 khong cover loadMeta.
                const metaPath = `${resolveFspath(args)}.meta`;
                if (!existsSync(metaPath)) { throw new Error(`Meta file not found: ${metaPath}`); }
                return {
                    meta: JSON.parse(readFileSync(metaPath, 'utf8')),
                    metaPath,
                    metaMtime: statSync(metaPath).mtimeMs,
                };
            }
            case 'types': {
                const map = Editor.assettype2name || {};
                return { types: Array.from(new Set(Object.values(map))).sort(), classToType: map };
            }
            case 'sub_assets': {
                const subs = args.uuid ? Editor.assetdb.subAssetInfosByUuid(args.uuid) : Editor.assetdb.subAssetInfos(requireUrl(args));
                return { assets: subs || [], total: (subs || []).length };
            }
            case 'used_by': {
                // Chieu nguoc cua `componentQuery props`: asset -> node nao dang tham chieu.
                // 2.4 KHONG co message `scene:query-node-by-asset` (3.x co) — nhung khong can:
                // scene-script co full cc.* nen walk cay + so uuid duoc.
                const uuid = args.uuid || Editor.assetdb.urlToUuid(requireUrl(args));
                if (!uuid) { throw new Error(`Cannot resolve uuid from url ${args.url}`); }
                const maxResults = args.maxResults || DEFAULT_USED_BY_LIMIT;
                const res = await sceneScript<any>('find-by-asset', uuid, { maxResults });
                const nodes = (res && res.nodes) || [];
                return { nodes, total: nodes.length, truncated: !!(res && res.truncated), uuid, maxResults };
            }
            case 'metas': {
                // queryMetas(pattern, type, cb) -> array meta instances, co circular ref nhu loadMeta.
                const pattern = args.pattern || 'db://assets/**/*';
                const type = args.type || '';
                const found = await cbToPromise<any[]>((cb) => (Editor.assetdb as any).queryMetas(pattern, type, cb));
                const limit = args.limit || DEFAULT_SEARCH_LIMIT;
                const sliced = found.slice(0, limit);
                const metas = sliced.map((m) => {
                    const s = safeSerialize(m);
                    if (s && typeof s === 'object') {
                        // Attach uuid/url hints if available on raw meta.
                        const uuid = (m as any).uuid || (m as any)._uuid;
                        const url = uuid ? Editor.assetdb.uuidToUrl(uuid) : null;
                        s.__uuid = uuid || undefined;
                        s.__url = url || undefined;
                    }
                    return s;
                });
                return { metas, total: found.length, truncated: found.length > limit };
            }
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'assetReadContent',
        'Read the text content of an asset file by url or uuid. Rejects binary extensions and files over the size cap.',
        {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Asset url, e.g. db://assets/Script/Foo.ts' },
                uuid: { type: 'string', description: 'Asset uuid (alternative to url)' },
                maxBytes: { type: 'number', description: `Size cap in bytes, default ${DEFAULT_MAX_BYTES}` },
            },
        },
        {
            type: 'object',
            properties: {
                content: { type: 'string' },
                fspath: { type: 'string' },
                bytes: { type: 'number' },
            },
            required: ['content', 'fspath', 'bytes'],
        },
        'GET', ['asset', 'read', 'content', 'file', 'source']
    )
    async assetReadContent(args: { url?: string, uuid?: string, maxBytes?: number }): Promise<{ content: string, fspath: string, bytes: number }> {
        if (!args.url && !args.uuid) { throw new Error('Either url or uuid is required'); }

        const fspath = resolveFspath(args);
        if (!existsSync(fspath)) { throw new Error(`File does not exist: ${fspath}`); }

        const ext = extname(fspath).toLowerCase();
        if (!READABLE_EXTENSIONS.includes(ext)) {
            throw new Error(`Extension ${ext || '(none)'} is not readable as text. Allowed: ${READABLE_EXTENSIONS.join(' ')}`);
        }

        const bytes = statSync(fspath).size;
        const maxBytes = args.maxBytes || DEFAULT_MAX_BYTES;
        if (bytes > maxBytes) {
            throw new Error(`File is ${bytes} bytes, over the ${maxBytes} byte cap. Raise maxBytes to read it anyway.`);
        }

        return { content: readFileSync(fspath, 'utf8'), fspath, bytes };
    }
}
