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

export class AssetReadTools {

    @utcpTool(
        'assetResolve',
        'Convert between asset url, uuid and filesystem path, or check existence. All operations are synchronous lookups in the editor asset database.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['uuid_from_url', 'url_from_uuid', 'fspath', 'exists'], description: 'Which conversion to perform' },
                url: { type: 'string', description: 'Asset url, e.g. db://assets/Scene/helloworld.fire' },
                uuid: { type: 'string', description: 'Asset uuid' },
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
            },
        },
        'GET', ['asset', 'uuid', 'url', 'path', 'resolve', 'exists']
    )
    async assetResolve(args: { operation: string, url?: string, uuid?: string }): Promise<{ uuid?: string, url?: string, fspath?: string, exists?: boolean }> {
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
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'assetQuery',
        'Query the asset database: glob search, folder tree, asset info, asset meta, registered asset types, sub-assets, or reverse lookup which scene nodes reference an asset (used_by).',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['search', 'tree', 'info', 'meta', 'types', 'sub_assets', 'used_by'], description: 'Which query to run' },
                pattern: { type: 'string', description: 'Glob for search, default db://assets/**/*' },
                assetTypes: { type: 'string', description: 'Comma-separated asset type names (not class names), e.g. texture,scene. Omit for all types' },
                url: { type: 'string', description: 'Asset url — for info / meta / sub_assets / used_by' },
                uuid: { type: 'string', description: 'Asset uuid — for info / meta / sub_assets / used_by' },
                limit: { type: 'number', description: `Max results for search, default ${DEFAULT_SEARCH_LIMIT}` },
                maxDepth: { type: 'number', description: `Max tree depth, default ${DEFAULT_TREE_DEPTH}` },
                maxResults: { type: 'number', description: `Max results for used_by, default ${DEFAULT_USED_BY_LIMIT}` },
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
                total: { type: 'number' },
                truncated: { type: 'boolean' },
            },
        },
        'GET', ['asset', 'search', 'tree', 'meta', 'info', 'types', 'query', 'used_by', 'reverse', 'reference']
    )
    async assetQuery(args: { operation: string, pattern?: string, assetTypes?: string, url?: string, uuid?: string, limit?: number, maxDepth?: number, maxResults?: number }): Promise<any> {
        switch (args.operation) {
            case 'search': {
                const pattern = args.pattern || 'db://assets/**/*';
                // assetTypes null = moi type (verify runtime — Unresolved phase 4).
                const types = args.assetTypes ? String(args.assetTypes).split(',').map((t) => t.trim()) : (null as any);
                const found = await cbToPromise<IQueryAssetResult2x[]>((cb) => Editor.assetdb.queryAssets(pattern, types, cb));
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
