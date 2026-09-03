import { utcpTool } from '../decorators';
import { Base64ImageSchema, IBase64Image, InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';
import path from 'path';
import os from 'os';
import { basename, extname } from 'path';
import fs from 'fs-extra';
import packageJSON from '../../../package.json';
import { AssetInfo, AssetOperationOption } from '@cocos/creator-types/editor/packages/asset-db/@types/public';
import { AssetTreeItemSchema, IAssetTreeItem } from '../schemas';
import { DEFAULT_TREE_MAX_DEPTH, DEFAULT_TREE_MAX_NODES } from '../utils/tools-utils';
import { VERBOSE_TREE_DEPTH, VERBOSE_TREE_NODES, VERBOSE_FILE_BYTES } from '../utils/verbose';
import { assetQueryMemo, invalidateAfterWrite } from '../utils/memo-cache';

// helpers (shared by previewManage + kept methods)
async function queryAssetsCompat(options: { pattern?: string, [k: string]: any }): Promise<any[]> {
    // M4 L2: asset listing is stable for seconds — cache 5s cross-request, keyed by serialized query.
    const cacheKey = JSON.stringify(options);
    const cached = assetQueryMemo.get<any[]>(cacheKey);
    if (cached) return cached;
    try {
        const result = await Editor.Message.request('asset-db', 'query-assets', options as any);
        if (Array.isArray(result)) { assetQueryMemo.set(cacheKey, result); return result; }
    } catch (e) {}
    const result = await Editor.Message.request('asset-db', 'query-assets', (options.pattern ?? 'db://assets/**') as any);
    if (Array.isArray(result)) assetQueryMemo.set(cacheKey, result);
    return Array.isArray(result) ? result : [];
}
async function toAssetUrl(id: string): Promise<string> {
    if (!id) throw new Error('Asset reference id is empty');
    if (id.startsWith('db://')) return id;
    const info = await Editor.Message.request('asset-db', 'query-asset-info', id).catch(() => null);
    if (info?.url) return info.url;
    const url = await Editor.Message.request('asset-db', 'query-url', id).catch(() => null);
    if (url) return url as string;
    throw new Error(`Cannot resolve asset reference '${id}' to a db:// url.`);
}
function normalizePath(p?: string): string {
    if (!p) return 'db://assets';
    let path2 = p.replace(/\\/g, '/').trim();
    if (path2.startsWith('db://')) return path2.endsWith('/') && path2 !== 'db://' ? path2.slice(0, -1) : path2;
    if (path2.startsWith('/')) path2 = path2.slice(1);
    if (path2 === '' || path2 === 'assets') return 'db://assets';
    if (path2.startsWith('assets/')) { const r='db://'+path2; return r.endsWith('/')?r.slice(0,-1):r; }
    if (path2.endsWith('/')) path2=path2.slice(0,-1);
    return `db://assets/${path2}`;
}
function boundedPositive(value: unknown, fallback: number, maximum: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.min(value, maximum)
        : fallback;
}

export class AssetTools {

    @utcpTool('assetGetTree', 'Get asset hierarchy tree. Defaults maxDepth=4/maxNodes=200; explicit values are capped at depth 99 and 10,000 nodes. Marks truncated branches.', {
        type: 'object',
        properties: {
            reference: InstanceReferenceSchema,
            assetPath: { type: 'string' },
            maxDepth: { type: 'number', minimum: 1, maximum: VERBOSE_TREE_DEPTH },
            maxNodes: { type: 'number', minimum: 1, maximum: VERBOSE_TREE_NODES },
            verbose: { type: 'boolean', description: 'When true, lifts omitted caps to verbose ceilings unless maxDepth/maxNodes explicitly set' }
        }
    }, AssetTreeItemSchema, "GET", ['asset', 'file', 'tree', 'hierarchy', 'folder', 'subasset'])
    async assetGetTree(args: { reference?: IInstanceReference, assetPath?: string, maxDepth?: number, maxNodes?: number, verbose?: boolean }): Promise<IAssetTreeItem> {
        if (args.reference) {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
            if (!info) throw new Error(`Asset with UUID ${args.reference.id} not found.`);
            args.assetPath = info.url;
        }
        let rootPath = normalizePath(args.assetPath);
        const pattern = `${rootPath}/**`;
        // M1: asset scan + root uuid are independent -> 1 round
        const [assets, rootUuid] = await Promise.all([
            queryAssetsCompat({ pattern }),
            Editor.Message.request('asset-db', 'query-uuid', rootPath),
        ]);
        const assetsMap = new Map<string, IAssetTreeItem>();
        const rootName = rootPath.split('/').pop() || 'assets';
        const rootNode: IAssetTreeItem = { filesystemPath: (Editor.Project as any).path + '/' + rootPath.replace('db://',''), reference:{id:rootUuid||'root', type:'folder'}, name:rootName, children:[] };
        assetsMap.set(rootPath, rootNode);
        assets.forEach((asset:any)=>{ if(asset.url===rootPath) return; assetsMap.set(asset.url,{ reference:{id:asset.uuid, type:asset.isDirectory?'folder':asset.type}, name:asset.name, children:[] }); });
        assets.forEach((asset:any)=>{ if(asset.url===rootPath) return; const ti=assetsMap.get(asset.url); if(!ti) return; const pu=asset.url.substring(0,asset.url.lastIndexOf('/')); const pi=assetsMap.get(pu); if(pi) pi.children.push(ti); });
        // ponytail: default budgets — a bare call must not dump the whole asset DB.
        // Defaults apply per-param only when omitted; pass larger values for the full
        // tree. Same truncated/childrenOmitted convention as nodeGetTree.
        const maxDepth = boundedPositive(args.maxDepth, args.verbose ? VERBOSE_TREE_DEPTH : DEFAULT_TREE_MAX_DEPTH, VERBOSE_TREE_DEPTH);
        const maxNodes = boundedPositive(args.maxNodes, args.verbose ? VERBOSE_TREE_NODES : DEFAULT_TREE_MAX_NODES, VERBOSE_TREE_NODES);
        const prune=(n:IAssetTreeItem,d:number)=>{ if(d>=maxDepth){ (n as any).truncated='maxDepth'; (n as any).childrenOmitted=n.children.length; (n as any).childrenCount=n.children.length; n.children=[]; } else n.children.forEach(c=>prune(c,d+1)); }; prune(rootNode,0);
        const budget={left:maxNodes}; const trunc=(n:IAssetTreeItem,d:number)=>{ const ch=n.children; if(!ch||!ch.length) return; (n as any).childrenCount=ch.length; const kept:IAssetTreeItem[]=[]; for(let i=0;i<ch.length;i++){ if(budget.left<=0){ (n as any).truncated=(n as any).truncated||'nodeLimit'; (n as any).childrenOmitted=ch.length-i; break; } budget.left--; trunc(ch[i],d+1); kept.push(ch[i]); } if(kept.length!==ch.length) n.children=kept; }; trunc(rootNode,0);
        return rootNode;
    }

    @utcpTool('assetGetAtPath','Get asset reference by db:// path.',{type:'object',properties:{assetPath:{type:'string'}},required:['assetPath']},{type:'object',properties:{reference:InstanceReferenceSchema},required:['reference']},"GET",['asset','get','path','look','find'])
    async assetGetAtPath(args:{assetPath:string}):Promise<{reference:IInstanceReference}>{ const p=normalizePath(args.assetPath); const info=await Editor.Message.request('asset-db','query-asset-info',p); if(!info) throw new Error(`Asset not found at path: ${p}`); return {reference:{id:info.uuid, type:info.type}}; }

    @utcpTool(
        'assetResolvePath',
        'Resolve asset locations (uuid <-> db:// url <-> filesystem path) and probe existence. Accepts uuid (reference) OR db:// path (assetPath).',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'db:// url or path, alternative to reference.id' }
            },
            anyOf: [
                { required: ['reference'] },
                { required: ['assetPath'] },
            ]
        },
        {
            type: 'object',
            properties: {
                filesystemPath: { type: 'string' },
                url: { type: 'string' },
                uuid: { type: 'string' },
                exists: { type: 'boolean' },
                isDirectory: { type: 'boolean' },
                type: { type: 'string' },
                importer: { type: 'string' },
                isSubAsset: { type: 'boolean', description: 'True if this asset is a sub-asset (e.g. sprite-frame inside a texture). Sourced from AssetInfo.isSubAsset.' },
                containsSubAssets: { type: 'boolean', description: 'True if this asset contains sub-assets.' },
                relativePath: { type: 'string', description: 'Path relative to project root (Editor.Project.path).' },
                backupPath: { type: 'string', description: 'Filesystem path of the .meta sidecar (fspath + .meta).' }
            },
            required: ['filesystemPath']
        },
        "GET",
        ['asset', 'resolve', 'path', 'url', 'filesystem', 'uuid', 'exists']
    )
    async assetResolvePath(args: { reference?: IInstanceReference, assetPath?: string }): Promise<{ filesystemPath: string, url?: string, uuid?: string, exists: boolean, isDirectory?: boolean, type?: string, importer?: string, isSubAsset?: boolean, containsSubAssets?: boolean, relativePath?: string, backupPath?: string }> {
        const id = args.reference?.id || (args.assetPath ? normalizePath(args.assetPath) : undefined);
        if (!id) throw new Error('assetResolvePath requires reference.id or assetPath');
        const asUuid = !id.startsWith('db://');

        let fp2: string | null = null;
        let url2: string | null = null;
        let inf3: any = null;

        if (asUuid) {
            // M1: query-path and query-asset-info both key on id -> 1 round instead of 2
            const [fp, inf] = await Promise.all([
                Editor.Message.request('asset-db', 'query-path', id),
                Editor.Message.request('asset-db', 'query-asset-info', id).catch(() => null),
            ]) as [string | null, any];
            fp2 = fp;
            inf3 = inf;
            if (!fp2) return { filesystemPath: '', url: undefined, uuid: id, exists: false };
            url2 = await Editor.Message.request('asset-db', 'query-url', fp2).catch(() => null);
        } else {
            const inf2: any = await Editor.Message.request('asset-db', 'query-asset-info', id).catch(() => null);
            if (inf2?.file) fp2 = inf2.file;
            else fp2 = await Editor.Message.request('asset-db', 'query-path', id).catch(() => null);
            url2 = id;
            inf3 = inf2; // same key -> reuse, avoids a 2nd identical lookup
        }

        if (!fp2) return { filesystemPath: '', url: asUuid ? undefined : id, uuid: asUuid ? id : undefined, exists: false };
        const uuidResolved = inf3?.uuid || (asUuid ? id : await Editor.Message.request('asset-db', 'query-uuid', id).catch(() => undefined) || undefined);
        // G1 parity: isSubAsset/containsSubAssets from AssetInfo, relativePath/backupPath derived.
        // 3.7.3 asset-db exposes no dedicated message for these (registry 45 msgs), so derive — guard
        // every field because AssetInfo shape is version-dependent.
        const subAssets3 = inf3?.subAssets;
        const containsSubAssets = subAssets3 ? (Array.isArray(subAssets3) ? subAssets3.length > 0 : Object.keys(subAssets3).length > 0) : false;
        // relativePath only makes sense inside the project — internal/engine assets
        // resolve outside projectPath and path.relative would return the absolute path.
        const projectPath3 = (Editor.Project as any)?.path;
        let relativePath: string | undefined;
        if (projectPath3 && fp2) {
            const rel = path.relative(projectPath3, fp2);
            if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) relativePath = rel;
        }
        const backupCandidate = fp2 + '.meta';
        const backupPath = fs.existsSync(backupCandidate) ? backupCandidate : undefined;
        return { filesystemPath: fp2, url: url2 || inf3?.url || undefined, uuid: uuidResolved, exists: !!inf3, isDirectory: inf3?.isDirectory, type: inf3?.type, importer: inf3?.importer, isSubAsset: inf3?.isSubAsset ?? false, containsSubAssets, relativePath, backupPath };
    }

    @utcpTool(
        'assetReadContent',
        'Read text content of an asset by uuid or db:// path. Rejects binary/oversized files; maxBytes or verbose=true (10MB) to raise the cap.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'db:// url or path' },
                maxBytes: { type: 'number', minimum: 1, maximum: VERBOSE_FILE_BYTES, description: 'Size cap in bytes, default 512KB; maximum 10MB' },
                verbose: { type: 'boolean', description: 'When true, lifts the omitted cap to 10MB; explicit maxBytes still wins.' }
            },
            anyOf: [
                { required: ['reference'] },
                { required: ['assetPath'] },
            ]
        },
        {
            type: 'object',
            properties: {
                content: { type: 'string' },
                filesystemPath: { type: 'string' },
                bytes: { type: 'number' },
                truncated: { type: 'boolean' }
            },
            required: ['content']
        },
        "GET",
        ['asset', 'read', 'content', 'text', 'file', 'source']
    )
    async assetReadContent(args: { reference?: IInstanceReference, assetPath?: string, maxBytes?: number, verbose?: boolean }): Promise<{ content: string, filesystemPath: string, bytes: number, truncated: boolean }> {
        const ident = args.reference?.id || (args.assetPath ? normalizePath(args.assetPath) : undefined);
        if (!ident) throw new Error('assetReadContent requires reference.id or assetPath');
        const asUuid2 = !ident.startsWith('db://');
        let fpR: string | null = null;
        if (asUuid2) fpR = await Editor.Message.request('asset-db', 'query-path', ident);
        else {
            const infR: any = await Editor.Message.request('asset-db', 'query-asset-info', ident).catch(() => null);
            if (infR?.file) fpR = infR.file;
            else fpR = await Editor.Message.request('asset-db', 'query-path', ident).catch(() => null);
        }
        if (!fpR) throw new Error('Asset not found: ' + ident);
        const fpResolved = fpR as string;
        const extR = path.extname(fpResolved).toLowerCase();
        const BINARY = ['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.ogg', '.wav', '.ttf', '.woff', '.mp4', '.mov', '.zip', '.gz', '.bmp', '.tga', '.psd'];
        if ((BINARY as string[]).includes(extR)) throw new Error('Extension ' + extR + ' is binary and not readable as text.');
        const stat: any = await (fs as any).stat(fpResolved).catch(() => null);
        if (!stat) throw new Error('File not found on disk: ' + fpResolved);
        const cap = boundedPositive(args.maxBytes, args.verbose ? VERBOSE_FILE_BYTES : 512 * 1024, VERBOSE_FILE_BYTES);
        if (stat.size > cap) throw new Error('File is ' + stat.size + ' bytes, over the ' + cap + ' byte cap. ' + (args.verbose ? 'Already at verbose cap (10MB).' : 'Pass verbose=true or maxBytes to raise it.'));
        const content = await (fs as any).readFile(fpResolved, 'utf8');
        return { content, filesystemPath: fpResolved, bytes: stat.size, truncated: false };
    }

    @utcpTool('assetFindReferences', 'Find asset references. Defaults direction to used_by; pass depends_on for assets this asset references. Returns at most 200 results by default and 1,000 at most.', {
        type: 'object',
        properties: {
            direction: { type: 'string', enum: ['used_by', 'depends_on'], default: 'used_by' },
            reference: InstanceReferenceSchema,
            assetKind: { type: 'string', enum: ['asset', 'script', 'all'], default: 'all' },
            resolveUrls: { type: 'boolean', default: false },
            limit: { type: 'number', minimum: 1, maximum: 1000, default: 200 },
        },
        required: ['reference'],
    }, {
        type: 'object',
        properties: {
            references: { type: 'array', items: InstanceReferenceSchema },
            assets: { type: 'array', items: { type: 'object', properties: { uuid: { type: 'string' }, url: { type: 'string' }, type: { type: 'string' } } } },
            total: { type: 'number' },
            truncated: { type: 'boolean' },
        },
        required: ['references', 'total', 'truncated'],
    }, "GET", ['asset', 'reference', 'dependency', 'used', 'usage', 'impact'])
    async assetFindReferences(args: { direction?: 'used_by' | 'depends_on', reference: IInstanceReference, assetKind?: string, resolveUrls?: boolean, limit?: number }): Promise<{ references: IInstanceReference[], assets?: Array<{ uuid: string, url?: string, type?: string }>, total: number, truncated: boolean }> {
        if (!args.reference?.id) throw new Error('assetFindReferences requires reference.id');
        const direction = args.direction ?? 'used_by';
        if (direction !== 'used_by' && direction !== 'depends_on') throw new Error(`Unknown direction: ${direction}`);
        const kind = args.assetKind ?? 'all';
        const candidates = direction === 'used_by'
            ? ['query-asset-users', 'query-asset-used']
            : ['query-asset-dependencies', 'query-asset-dependinces'];
        let raw: unknown;
        let lastError: unknown;
        for (const method of candidates) {
            try {
                raw = await Editor.Message.request('asset-db', method, args.reference.id, kind);
                lastError = undefined;
                break;
            } catch (error: unknown) {
                lastError = error;
            }
        }
        if (lastError) {
            const reason = lastError instanceof Error ? lastError.message : String(lastError);
            throw new Error(`Failed to query asset ${direction}: ${reason}`);
        }
        const list: unknown[] = Array.isArray(raw) ? raw : [];
        const uuids = list.flatMap((item): string[] => {
            if (typeof item === 'string') return item ? [item] : [];
            if (!item || typeof item !== 'object') return [];
            const uuid: unknown = Reflect.get(item, 'uuid') ?? Reflect.get(item, 'id');
            return typeof uuid === 'string' && uuid ? [uuid] : [];
        });
        const total = uuids.length;
        const limit = boundedPositive(args.limit, 200, 1000);
        const limitedUuids = uuids.slice(0, limit);
        const references = limitedUuids.map((id): IInstanceReference => ({ id }));
        const truncated = total > references.length;
        if (!args.resolveUrls) return { references, total, truncated };
        const assets: Array<{ uuid: string, url?: string, type?: string }> = [];
        for (const uuid of limitedUuids) {
            const info: AssetInfo | null = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
            assets.push({ uuid, url: info?.url, type: info?.type });
        }
        return { references, assets, total, truncated };
    }

    @utcpTool('assetQuery', 'Search asset database by glob, ccType, importer, extname or isBundle. At least one filter is required. Returns at most 200 results by default and 1,000 at most.', {
        type: 'object',
        properties: {
            pattern: { type: 'string' },
            ccType: { type: 'string' },
            importer: { type: 'string' },
            extname: { type: 'string' },
            isBundle: { type: 'boolean' },
            limit: { type: 'number', minimum: 1, maximum: 1000, default: 200 },
        },
        anyOf: [
            { required: ['pattern'] },
            { required: ['ccType'] },
            { required: ['importer'] },
            { required: ['extname'] },
            { required: ['isBundle'] },
        ],
    }, {
        type: 'object',
        properties: {
            assets: { type: 'array', items: { type: 'object', properties: { uuid: { type: 'string' }, name: { type: 'string' }, url: { type: 'string' }, type: { type: 'string' }, importer: { type: 'string' }, isDirectory: { type: 'boolean' } } } },
            total: { type: 'number' },
            truncated: { type: 'boolean' },
        },
        required: ['assets', 'total', 'truncated'],
    }, "GET", ['asset', 'query', 'search', 'find', 'filter', 'list', 'discover', 'bundle', 'spine', 'prefab'])
    async assetQuery(args: { pattern?: string, ccType?: string, importer?: string, extname?: string, isBundle?: boolean, limit?: number }): Promise<{ assets: { uuid: string, name: string, url: string, type: string, importer?: string, isDirectory: boolean }[], total: number, truncated: boolean }> {
        const opts: { pattern?: string, ccType?: string, importer?: string, extname?: string, isBundle?: boolean } = {};
        if (args.pattern) opts.pattern = normalizePath(args.pattern);
        if (args.ccType) opts.ccType = args.ccType;
        if (args.importer) opts.importer = args.importer;
        if (args.extname) opts.extname = args.extname;
        if (args.isBundle !== undefined) opts.isBundle = args.isBundle;
        if (Object.keys(opts).length === 0) throw new Error('assetQuery requires at least one filter');

        const raw = await queryAssetsCompat(opts) as Array<{ uuid: string, name: string, url: string, type: string, importer?: string, isDirectory?: boolean, isBundle?: boolean }>;
        const filtered = raw.filter((asset) => {
            if (opts.ccType && asset.type !== opts.ccType) return false;
            if (opts.importer && asset.importer !== opts.importer) return false;
            if (opts.extname && extname(asset.url || asset.name || '') !== opts.extname) return false;
            if (opts.isBundle !== undefined && !!asset.isBundle !== opts.isBundle) return false;
            return true;
        });
        const limit = boundedPositive(args.limit, 200, 1000);
        const assets = filtered.slice(0, limit).map((asset) => ({
            uuid: asset.uuid,
            name: asset.name,
            url: asset.url,
            type: asset.isDirectory ? 'folder' : asset.type,
            importer: asset.importer,
            isDirectory: !!asset.isDirectory,
        }));
        return { assets, total: filtered.length, truncated: filtered.length > assets.length };
    }

    @utcpTool('assetSaveContent', 'Overwrite content of a text-based asset (TS, JSON, effect, txt). Identify by db:// path or uuid. No binary.', {
        type: 'object',
        properties: {
            assetPath: { type: 'string' },
            reference: InstanceReferenceSchema,
            content: { type: 'string' },
        },
        required: ['content'],
        anyOf: [
            { required: ['reference'] },
            { required: ['assetPath'] },
        ],
    }, { type: 'object', properties: { reference: InstanceReferenceSchema, filesystemPath: { type: 'string' } }, required: ['reference'] }, "POST", ['asset', 'save', 'write', 'content', 'script', 'text', 'edit', 'generate'])
    async assetSaveContent(args:{assetPath?:string,reference?:IInstanceReference,content:string}):Promise<{reference:IInstanceReference,filesystemPath?:string}>{ let url:string|null=null; if(args.reference&&args.reference.id){ const info=await Editor.Message.request('asset-db','query-asset-info',args.reference.id); if(!info) throw new Error(`Asset ${args.reference.id} not found`); url=info.url; } else if(args.assetPath) url=normalizePath(args.assetPath); if(!url) throw new Error('assetSaveContent requires assetPath or reference.id'); const result=await Editor.Message.request('asset-db','save-asset',url,args.content??''); if(!result) throw new Error(`Failed to save content to ${url}`); invalidateAfterWrite(); return {reference:{id:result.uuid,type:result.type},filesystemPath:result.file||undefined}; }

    @utcpTool('assetGetAvailableUrl','Return a non-colliding db:// url for the given path (appends suffix if exists). Use before assetCreate.',{type:'object',properties:{assetPath:{type:'string'}},required:['assetPath']},{type:'object',properties:{url:{type:'string'}},required:['url']},"GET",['asset','available','url','collision','unique','name'])
    async assetGetAvailableUrl(args:{assetPath:string}):Promise<{url:string}>{ if(!args.assetPath) throw new Error('assetGetAvailableUrl requires assetPath'); const url=await Editor.Message.request('asset-db','generate-available-url',normalizePath(args.assetPath)); if(!url) throw new Error(`Failed to generate available url for ${args.assetPath}`); return {url}; }

    @utcpTool('assetCreate','Create empty asset or folder at db:// path.',{type:'object',properties:{assetPath:{type:'string'},preset:{type:'string',enum:['folder','material','effect','scene','prefab','typescript','animation-clip','render-texture','physics-material','animation-graph','animation-graph-variant','animation-mask','auto-atlas','effect-header','label-atlas','terrain']},options:{type:'object',properties:{overwrite:{type:'boolean'},rename:{type:'boolean'}},nullable:true}},required:['assetPath','preset']},{type:'object',properties:{reference:InstanceReferenceSchema},required:['reference']},"POST",['asset','create','new','preset','folder','typescript'])
    async assetCreate(args:{assetPath:string;preset:string;options?:{overwrite?:boolean,rename?:boolean}}):Promise<{reference:IInstanceReference}>{ let targetPath=normalizePath(args.assetPath); const type=args.preset; const presetMap:Record<string,string>={ 'material':'db://internal/default_file_content/material/default.mtl','effect':'db://internal/default_file_content/effect/default.effect','scene':'db://internal/default_file_content/scene/default.scene','prefab':'db://internal/default_file_content/prefab/default.prefab','animation-clip':'db://internal/default_file_content/animation-clip/default.anim','render-texture':'db://internal/default_file_content/render-texture/default.rt','physics-material':'db://internal/default_file_content/physics-material/default.pmtl','animation-graph':'db://internal/default_file_content/animation-graph/default.animgraph','animation-graph-variant':'db://internal/default_file_content/animation-graph-variant/default.animgraphvari','animation-mask':'db://internal/default_file_content/animation-mask/default.animask','auto-atlas':'db://internal/default_file_content/auto-atlas/default.pac','effect-header':'db://internal/default_file_content/effect-header/chunk','label-atlas':'db://internal/default_file_content/label-atlas/default.labelatlas','terrain':'db://internal/default_file_content/terrain/default.terrain'}; const assetOptions:AssetOperationOption={overwrite:args.options?.overwrite??false,rename:args.options?.rename??false}; let result2: any = null; if(type==='folder'||type==='typescript'){ let content:string|null=null; if(type==='typescript'){ const ce=extname(targetPath); if(ce!=='.ts'){ targetPath=ce?targetPath.slice(0,-ce.length):targetPath; targetPath+='.ts'; } const cn=basename(targetPath.slice('db://'.length),'.ts'); content=this.generateTypescriptClassTemplate(cn);} result2=await Editor.Message.request('asset-db','create-asset',targetPath,content,assetOptions); if(!result2) throw new Error(`Failed to create folder at ${targetPath}`); invalidateAfterWrite(); return {reference:{id:result2.uuid,type:type}}; } const source=presetMap[type]; if(!source) throw new Error(`Unknown asset preset type: ${type}`); if(extname(targetPath)===''&&type!=='folder') targetPath+=type=='chunk'?'.chunk':extname(presetMap[type]); const assetInfo=await Editor.Message.request('asset-db','copy-asset',source,targetPath,assetOptions); if(!assetInfo) throw new Error(`Failed to create asset at ${targetPath}`); invalidateAfterWrite(); return {reference:{id:assetInfo.uuid,type:assetInfo.type}}; }

    @utcpTool('assetImport','Import external file as asset.',{type:'object',properties:{sourceFilesystemPath:{type:'string'},targetAssetPath:{type:'string'},imageType:{type:'string',enum:['raw','texture','normal-map','sprite-frame','texture-cube']},options:{type:'object',properties:{overwrite:{type:'boolean'},rename:{type:'boolean'}}}},required:['sourceFilesystemPath','targetAssetPath']},{type:'object',properties:{reference:InstanceReferenceSchema},required:['reference']},"POST",['asset','import','file','external','image'])
    async assetImport(args:{sourceFilesystemPath:string,targetAssetPath:string,imageType?:string,options?:{overwrite?:boolean,rename?:boolean}}):Promise<{reference:IInstanceReference}>{ let targetPath=normalizePath(args.targetAssetPath); const assetOptions:AssetOperationOption={overwrite:args.options?.overwrite??false,rename:args.options?.rename??false}; if(args.sourceFilesystemPath.startsWith('~')) args.sourceFilesystemPath=path.join(os.homedir(),args.sourceFilesystemPath.slice(1)); args.sourceFilesystemPath=path.resolve(args.sourceFilesystemPath); args.sourceFilesystemPath=await fs.realpath(args.sourceFilesystemPath); let existingAssetInfo:AssetInfo|null=null; if(`${(Editor.Project as any).path}${targetPath.slice('db:/'.length)}`===args.sourceFilesystemPath){ await Editor.Message.request('asset-db','refresh-asset',targetPath); existingAssetInfo=await Editor.Message.request('asset-db','query-asset-info',targetPath);} const assetInfo=existingAssetInfo?existingAssetInfo:await Editor.Message.request('asset-db','import-asset',args.sourceFilesystemPath,targetPath,assetOptions); if(!assetInfo) throw new Error(`Failed to import asset to ${targetPath}`); if(assetInfo.extends&&assetInfo.importer==='image'&&args.imageType){ const meta=await Editor.Message.request('asset-db','query-asset-meta',assetInfo.uuid); if(meta&&meta.userData){ let t=args.imageType; if(t==='normal-map') t='normal map'; if(t==='texture-cube') t='texture cube'; meta.userData.type=t; await Editor.Message.request('asset-db','save-asset-meta',assetInfo.uuid,JSON.stringify(meta)); }} invalidateAfterWrite(); return {reference:{id:assetInfo.uuid,type:assetInfo.type}}; }

    @utcpTool('assetOperate', 'Move/copy/delete/open/refresh/reimport asset, or save_meta (read meta via assetDbQuery meta first).', {
        type: 'object',
        properties: {
            operation: { type: 'string', enum: ['move', 'copy', 'delete', 'open', 'refresh', 'reimport', 'save_meta'] },
            reference: InstanceReferenceSchema,
            targetAssetPath: { type: 'string' },
            meta: { description: 'For save_meta: full meta object (or JSON string) from assetDbQuery meta, mutated' },
            options: { type: 'object', properties: { overwrite: { type: 'boolean' }, rename: { type: 'boolean' } }, nullable: true },
        },
        required: ['operation', 'reference'],
        anyOf: [
            { properties: { operation: { const: 'move' } }, required: ['targetAssetPath'] },
            { properties: { operation: { const: 'copy' } }, required: ['targetAssetPath'] },
            { properties: { operation: { const: 'save_meta' } }, required: ['meta'] },
            { properties: { operation: { const: 'delete' } } },
            { properties: { operation: { const: 'open' } } },
            { properties: { operation: { const: 'refresh' } } },
            { properties: { operation: { const: 'reimport' } } },
        ],
    }, { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST", ['asset', 'operate', 'move', 'copy', 'delete', 'open', 'refresh', 'reimport', 'meta'])
    async assetOperate(args:{operation:string,reference:IInstanceReference,targetAssetPath?:string,meta?:any,options?:{overwrite?:boolean,rename?:boolean}}):Promise<{reference:IInstanceReference}>{ const assetOptions={overwrite:args.options?.overwrite??false,rename:args.options?.rename??false}; const sourceUrl=await toAssetUrl(args.reference.id); const hasTarget=!!args.targetAssetPath; args.targetAssetPath=normalizePath(args.targetAssetPath); let result:AssetInfo|null=null; switch(args.operation){ case 'move': if(!hasTarget) throw new Error('targetAssetPath is required for move'); result=await Editor.Message.request('asset-db','move-asset',sourceUrl,args.targetAssetPath,assetOptions); break; case 'copy': if(!hasTarget) throw new Error('targetAssetPath is required for copy'); result=await Editor.Message.request('asset-db','copy-asset',sourceUrl,args.targetAssetPath,assetOptions); break; case 'delete': result=await Editor.Message.request('asset-db','delete-asset',sourceUrl); break; case 'open': await Editor.Message.request('asset-db','open-asset',args.reference.id); result=null; break; case 'refresh': await Editor.Message.request('asset-db','refresh-asset',sourceUrl); result=null; break; case 'reimport': await Editor.Message.request('asset-db','reimport-asset',sourceUrl); result=null; break; case 'save_meta': { if(args.meta===undefined||args.meta===null) throw new Error('save_meta requires meta (read it with assetDbQuery meta, mutate, pass back)'); const payload=typeof args.meta==='string'?args.meta:JSON.stringify(args.meta); const saved=await Editor.Message.request('asset-db','save-asset-meta',args.reference.id,payload); if(!saved) throw new Error(`Failed to save meta for ${args.reference.id}`); result=null; break; } default: throw new Error(`Unknown operation: ${args.operation}`);} if (result || ['move','copy','delete','refresh','reimport'].includes(args.operation)) invalidateAfterWrite(); return {reference:{id:result?.uuid??args.reference.id, type:result?.type??args.reference.type??''}}; }

    // assetGetPreview is now via previewManage (consolidated) — method kept for delegation, no @utcpTool
    async assetGetPreview(args: { reference: IInstanceReference, imageSize?: number, jpegQuality?: number, transparentColor?: { r: number, g: number, b: number } }): Promise<IBase64Image> {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
        if (!info) throw new Error(`Asset ${args.reference.id} not found.`);
        if (!info.importer) throw new Error(`Asset ${args.reference.id} has no importer and cannot be previewed.`);
        args.imageSize = args.imageSize || 512; args.jpegQuality = args.jpegQuality || 80; args.transparentColor = args.transparentColor || { r:0,g:0,b:0 };
        let importer = info.importer;
        const supportedImporters=['erp-texture-cube','image','sprite-frame','texture','fbx','gltf','gltf-mesh','prefab','material','spine','gltf-skeleton','scene'];
        if (!supportedImporters.includes(importer)) throw new Error(`Asset preview not supported for asset type: ${info.type}`);
        if (importer==='fbx'||importer==='gltf'){ const mesh=Object.values(info.subAssets).find((s:any)=>s.importer==='gltf-mesh'); if(!mesh) throw new Error(`Asset ${args.reference.id} has no gltf-mesh sub-asset.`); args.reference.id=(mesh as any).uuid; importer='gltf-mesh'; }
        let sourcePath:string|null=null;
        if (importer==='gltf-mesh'||importer==='mesh') sourcePath=(await Editor.Message.request('asset-db','query-asset-thumbnail',args.reference.id,"origin") as any).value;
        else if (['erp-texture-cube','image','sprite-frame','texture'].includes(importer)){ let fu=args.reference.id; if(fu.includes('@')) fu=fu.split('@')[0]; const fi=await Editor.Message.request('asset-db','query-asset-info',fu); if(fi&&fi.file) sourcePath=fi.file; }
        if (sourcePath && fs.existsSync(sourcePath)){
            try{ const sharp=require('sharp'); const image=sharp(sourcePath); const meta=await image.metadata(); const rs=args.imageSize||512; let proc=image; if((meta.width&&meta.width>rs)||(meta.height&&meta.height>rs)) proc=proc.resize(rs,rs,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}); let buf; if(meta.format==='png'||meta.hasAlpha) buf=await proc.flatten({background:args.transparentColor}).jpeg({quality:args.jpegQuality||80}).toBuffer(); else buf=await proc.jpeg({quality:args.jpegQuality||80}).toBuffer(); return {type:"image",data:buf.toString('base64'),mimeType:"image/jpeg"}; }catch(e){ console.error(`Failed sharp ${sourcePath}:`,e); }
        }
        const previewPanel=`${packageJSON.name}.preview`; const panelApi=Editor.Panel as any; if(typeof panelApi.openBeside==='function') await panelApi.openBeside('scene',previewPanel); else await Editor.Panel.open(previewPanel);
        let b64:string; try{ b64=await Editor.Message.request(packageJSON.name,'generate-preview',args.reference.id,args.imageSize||512,args.imageSize||512,(args.jpegQuality||80)/100);} finally{ await Editor.Panel.close(previewPanel); } if(!b64) throw new Error(`Failed to generate preview for asset ${args.reference.id}.`); return {type:"image",data:b64,mimeType:"image/jpeg"};
    }

    private generateTypescriptClassTemplate(className: string): string {
        return `import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('${className}')
export class ${className} extends Component {
    start() {}
    update(deltaTime: number) {}
}`;
    }
}
