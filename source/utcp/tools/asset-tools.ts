import packageJSON from '../../../package.json';
import sharp from 'sharp';
import fs from 'fs-extra';
import { utcpTool } from '../decorators';
import { AssetInfo, AssetOperationOption } from '@cocos/creator-types/editor/packages/asset-db/@types/public';
import { AssetTreeItemSchema, IAssetTreeItem, Base64ImageSchema, IBase64Image, SuccessIndicatorSchema, ISuccessIndicator, InstanceReferenceSchema, IInstanceReference } from '../schemas';
import path, { basename, extname } from 'path';
import os from 'os';

function normalizePath(p?: string): string {
    if (!p) return 'db://assets';
    let path = p.replace(/\\/g, '/').trim();

    // Handle db:// protocol
    if (path.startsWith('db://')) {
        return path.endsWith('/') && path !== 'db://' ? path.slice(0, -1) : path;
    }

    // Remove leading slash
    if (path.startsWith('/')) {
        path = path.slice(1);
    }

    // Handle root aliases
    if (path === '' || path === 'assets') {
        return 'db://assets';
    }

    // Handle 'assets/' prefix
    if (path.startsWith('assets/')) {
        const result = 'db://' + path;
        return result.endsWith('/') ? result.slice(0, -1) : result;
    }

    // Treat as relative path under assets
    if (path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    return `db://assets/${path}`;
}

export class AssetTools {

    @utcpTool(
        'assetGetTree',
        'Get the asset and subAsset hierarchy tree. Children have recursive structure.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                assetPath: { type: 'string', description: 'Root path to start from' }
            }
        },
        AssetTreeItemSchema, "GET", ['asset', 'file', 'tree', 'hierarchy', 'folder', 'subasset']
    )
    async assetGetTree(args: { reference?: IInstanceReference, assetPath?: string }): Promise<IAssetTreeItem> {
        if (args.reference) {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
            if (!info) {
                throw new Error(`Asset with UUID ${args.reference.id} not found.`);
            }
            args.assetPath = info.url;
        }

        let rootPath = normalizePath(args.assetPath);

        const pattern = `${rootPath}/**`;
        const assets = await Editor.Message.request('asset-db', 'query-assets', { pattern });
        const rootUuid = await Editor.Message.request('asset-db', 'query-uuid', rootPath);

        const assetsMap = new Map<string, IAssetTreeItem>();

        // Create Root Node first
        const rootName = rootPath.split('/').pop() || 'assets';
        const rootNode: IAssetTreeItem = {
            filesystemPath: Editor.Project.path + '/' + rootPath.replace('db://', ''),
            reference: { id: rootUuid || 'root', type: 'folder' },
            name: rootName,
            children: []
        };
        assetsMap.set(rootPath, rootNode);

        // First pass: Map assets
        assets.forEach((asset: any) => {
            if (asset.url === rootPath) return; // Skip root, already created

            const type = asset.isDirectory ? 'folder' : asset.type;

            const treeItem: IAssetTreeItem = {
                reference: { id: asset.uuid, type: type },
                name: asset.name,
                children: []
            };

            assetsMap.set(asset.url, treeItem);
        });

        // Second pass: Build hierarchy
        assets.forEach((asset: any) => {
            if (asset.url === rootPath) return;

            const treeItem = assetsMap.get(asset.url);
            if (!treeItem) return;

            const parentUrl = asset.url.substring(0, asset.url.lastIndexOf('/'));
            const parentItem = assetsMap.get(parentUrl);

            if (parentItem) {
                parentItem.children.push(treeItem);
            }
        });

        return rootNode;
    }

    @utcpTool(
        'assetGetAtPath',
        'Get asset reference by given local path and name, including extension. Can be used for subassets too. Returns reference to the asset.',
        {
            type: 'object',
            properties: {
                assetPath: { type: 'string' }
            },
            required: ['assetPath']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "GET", ['asset', 'get', 'path', 'look', 'find']
    )
    async assetGetAtPath(args: { assetPath: string }): Promise<{ reference: IInstanceReference }> {
        let targetPath = normalizePath(args.assetPath);

        console.log(`Looking for asset at path: ${targetPath}`);

        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', targetPath);
        if (!assetInfo) {
            throw new Error(`Asset not found at path: ${targetPath}`);
        } else {
            return { reference: { id: assetInfo.uuid, type: assetInfo.type } };
        }
    }

    @utcpTool(
        'assetResolvePath',
        'Resolve filesystem path and db:// url for an asset by its uuid. Lighter than query-asset-info when you only need locations (e.g. to read the file directly).',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema
            },
            required: ['reference']
        },
        { type: 'object', properties: { filesystemPath: { type: 'string' }, url: { type: 'string' } }, required: ['filesystemPath'] }, "GET", ['asset', 'resolve', 'path', 'url', 'filesystem', 'uuid']
    )
    async assetResolvePath(args: { reference: IInstanceReference }): Promise<{ filesystemPath: string, url?: string }> {
        if (!args.reference || !args.reference.id) {
            throw new Error('assetResolvePath requires reference.id (asset uuid)');
        }
        const filesystemPath = await Editor.Message.request('asset-db', 'query-path', args.reference.id);
        if (!filesystemPath) {
            throw new Error(`No filesystem path found for asset ${args.reference.id}`);
        }
        const url = await Editor.Message.request('asset-db', 'query-url', filesystemPath);
        return { filesystemPath, url: url || undefined };
    }

    @utcpTool(
        'assetFindReferences',
        'Asset-level dependency analysis. "used_by" lists the assets/scripts that reference the given asset (who breaks if it is deleted); "depends_on" lists the assets it references itself. Complements findNodesByAsset, which only looks inside the currently open scene.',
        {
            type: 'object',
            properties: {
                direction: { type: 'string', enum: ['used_by', 'depends_on'] },
                reference: InstanceReferenceSchema,
                assetKind: { type: 'string', enum: ['asset', 'script', 'all'], description: 'Which kind of referrer/dependency to include', default: 'all' },
                resolveUrls: { type: 'boolean', description: 'Also resolve the db:// url and type of each result (one extra query per uuid)', default: false }
            },
            required: ['direction', 'reference']
        },
        {
            type: 'object',
            properties: {
                references: { type: 'array', items: InstanceReferenceSchema },
                assets: {
                    type: 'array',
                    items: { type: 'object', properties: { uuid: { type: 'string' }, url: { type: 'string' }, type: { type: 'string' } } },
                    description: 'Only present when resolveUrls is true'
                },
                total: { type: 'number' }
            },
            required: ['references', 'total']
        }, "GET", ['asset', 'reference', 'dependency', 'dependencies', 'used', 'usage', 'impact', 'who', 'delete', 'safe']
    )
    async assetFindReferences(args: { direction: string, reference: IInstanceReference, assetKind?: string, resolveUrls?: boolean }):
        Promise<{ references: IInstanceReference[], assets?: Array<{ uuid: string, url?: string, type?: string }>, total: number }> {
        if (!args.reference || !args.reference.id) {
            throw new Error('assetFindReferences requires reference.id (asset uuid or db:// url)');
        }
        const kind = args.assetKind || 'all';

        // Message names were renamed between editor versions: 3.8.x uses the corrected
        // spelling, 3.7.x shipped 'query-asset-used' / 'query-asset-dependinces' (sic).
        const candidates = args.direction === 'used_by'
            ? ['query-asset-users', 'query-asset-used']
            : args.direction === 'depends_on'
                ? ['query-asset-dependencies', 'query-asset-dependinces']
                : [];
        if (candidates.length === 0) {
            throw new Error(`Unknown direction: ${args.direction}`);
        }

        let raw: any;
        let lastError: any;
        for (const message of candidates) {
            try {
                raw = await Editor.Message.request('asset-db', message, args.reference.id, kind);
                lastError = undefined;
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (lastError) {
            throw new Error(`Failed to query asset ${args.direction} for ${args.reference.id}. Tried ${candidates.join(', ')}. Reason: ${(lastError as any)?.message || lastError}`);
        }

        // Result is documented as string[] but be tolerant of info objects
        const list: any[] = Array.isArray(raw) ? raw : [];
        const uuids = list
            .map((item: any) => typeof item === 'string' ? item : (item?.uuid || item?.id))
            .filter((uuid: any): uuid is string => typeof uuid === 'string' && !!uuid);

        const references: IInstanceReference[] = uuids.map((uuid) => ({ id: uuid }));
        if (!args.resolveUrls) {
            return { references, total: references.length };
        }

        const assets: Array<{ uuid: string, url?: string, type?: string }> = [];
        for (const uuid of uuids) {
            const info: AssetInfo | null = await Editor.Message.request('asset-db', 'query-asset-info', uuid);
            assets.push({ uuid, url: info?.url, type: info?.type });
        }
        return { references, assets, total: references.length };
    }

    @utcpTool(
        'assetQuery',
        'Search the asset database with filters: glob pattern, asset type (ccType), importer, extension or bundle flag. Returns a slim list of matching assets. Use for asset discovery (e.g. all prefabs under a folder, all spine skeletons of a game). At least one filter is required.',
        {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Glob path pattern, e.g. "games/1234/**" or "db://assets/prefabs/**/*.prefab"' },
                ccType: { type: 'string', description: 'Asset type filter, e.g. cc.Prefab, cc.SpriteFrame, sp.SkeletonData, cc.AnimationClip' },
                importer: { type: 'string', description: 'Importer name filter, e.g. image, spine, fbx, gltf, typescript, scene' },
                extname: { type: 'string', description: 'Extension filter, e.g. .prefab, .ts' },
                isBundle: { type: 'boolean', description: 'Only list asset bundles' },
                limit: { type: 'number', description: 'Max number of results to return', default: 200 }
            }
        },
        {
            type: 'object',
            properties: {
                assets: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            uuid: { type: 'string' },
                            name: { type: 'string' },
                            url: { type: 'string' },
                            type: { type: 'string' },
                            importer: { type: 'string' },
                            isDirectory: { type: 'boolean' }
                        }
                    }
                },
                total: { type: 'number' },
                truncated: { type: 'boolean' }
            },
            required: ['assets', 'total', 'truncated']
        }, "GET", ['asset', 'query', 'search', 'find', 'filter', 'list', 'discover', 'bundle', 'spine', 'prefab']
    )
    async assetQuery(args: { pattern?: string, ccType?: string, importer?: string, extname?: string, isBundle?: boolean, limit?: number }):
        Promise<{ assets: { uuid: string, name: string, url: string, type: string, importer?: string, isDirectory: boolean }[], total: number, truncated: boolean }> {
        const options: { pattern?: string, ccType?: string, importer?: string, extname?: string, isBundle?: boolean } = {};
        if (args.pattern) {
            options.pattern = normalizePath(args.pattern);
        }
        if (args.ccType) {
            options.ccType = args.ccType;
        }
        if (args.importer) {
            options.importer = args.importer;
        }
        if (args.extname) {
            options.extname = args.extname;
        }
        if (args.isBundle !== undefined) {
            options.isBundle = args.isBundle;
        }
        if (Object.keys(options).length === 0) {
            throw new Error('assetQuery requires at least one filter (pattern, ccType, importer, extname or isBundle)');
        }

        const results = await Editor.Message.request('asset-db', 'query-assets', options);
        if (!Array.isArray(results)) {
            throw new Error('Unexpected result from asset-db query-assets');
        }

        const limit = args.limit && args.limit > 0 ? args.limit : 200;
        const sliced = results.slice(0, limit);
        return {
            assets: sliced.map((a: any) => ({
                uuid: a.uuid,
                name: a.name,
                url: a.url,
                type: a.isDirectory ? 'folder' : a.type,
                importer: a.importer,
                isDirectory: !!a.isDirectory
            })),
            total: results.length,
            truncated: results.length > limit
        };
    }

    @utcpTool(
        'assetSaveContent',
        'Overwrite the content of an existing text-based asset (TypeScript script, JSON, effect, txt...). Identify the asset by db:// path or uuid. Use for generated/templated files (e.g. rewriting GameInit<ID>.ts during new-game setup). Binary assets are not supported.',
        {
            type: 'object',
            properties: {
                assetPath: { type: 'string', description: 'db:// or project-relative path of the asset' },
                reference: InstanceReferenceSchema,
                content: { type: 'string', description: 'New text content of the asset' }
            },
            required: ['content']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema, filesystemPath: { type: 'string' } }, required: ['reference'] }, "POST", ['asset', 'save', 'write', 'content', 'script', 'text', 'edit', 'generate']
    )
    async assetSaveContent(args: { assetPath?: string, reference?: IInstanceReference, content: string }): Promise<{ reference: IInstanceReference, filesystemPath?: string }> {
        let url: string | null = null;
        if (args.reference && args.reference.id) {
            const info = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
            if (!info) {
                throw new Error(`Asset ${args.reference.id} not found`);
            }
            url = info.url;
        } else if (args.assetPath) {
            url = normalizePath(args.assetPath);
        }
        if (!url) {
            throw new Error('assetSaveContent requires assetPath or reference.id');
        }

        const result = await Editor.Message.request('asset-db', 'save-asset', url, args.content ?? '');
        if (!result) {
            throw new Error(`Failed to save content to ${url}`);
        }
        return { reference: { id: result.uuid, type: result.type }, filesystemPath: result.file || undefined };
    }

    @utcpTool(
        'assetGetAvailableUrl',
        'Given a desired db:// path, returns an available (non-colliding) url - appends a suffix if an asset already exists at that path. Use before assetCreate/assetImport when overwriting is not wanted.',
        {
            type: 'object',
            properties: {
                assetPath: { type: 'string', description: 'Desired db:// or project-relative path' }
            },
            required: ['assetPath']
        },
        { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, "GET", ['asset', 'available', 'url', 'collision', 'unique', 'name']
    )
    async assetGetAvailableUrl(args: { assetPath: string }): Promise<{ url: string }> {
        if (!args.assetPath) {
            throw new Error('assetGetAvailableUrl requires assetPath');
        }
        const url = await Editor.Message.request('asset-db', 'generate-available-url', normalizePath(args.assetPath));
        if (!url) {
            throw new Error(`Failed to generate available url for ${args.assetPath}`);
        }
        return { url };
    }

    @utcpTool(
        'assetCreate',
        'Create empty asset or folder of given type. Automatically handles folders creation along the path. Returns reference to the new asset.',
        {
            type: 'object',
            properties: {
                assetPath: { type: 'string' },
                preset: {
                    type: 'string',
                    enum: [
                        'folder',
                        'material',
                        'effect',
                        'scene',
                        'prefab',
                        'typescript',
                        'animation-clip',
                        'render-texture',
                        'physics-material',
                        'animation-graph',
                        'animation-graph-variant',
                        'animation-mask',
                        'auto-atlas',
                        'effect-header',
                        'label-atlas',
                        'terrain'
                    ],
                    description: 'Preset type for the new asset'
                },
                options: { type: 'object', properties: { overwrite: { type: 'boolean' }, rename: { type: 'boolean' } }, description: 'Additional options for the operation', nullable: true },
            },
            required: ['assetPath', 'preset']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST", ['asset', 'create', 'new', 'preset', 'folder', 'typescript']
    )
    async assetCreate(args: { assetPath: string; preset: string; options?: { overwrite?: boolean, rename?: boolean } }): Promise<{ reference: IInstanceReference }> {
        let targetPath = normalizePath(args.assetPath);

        // Map 'preset' from schema to 'type' expected by function
        const type = args.preset;
        const presetMap: Record<string, string> = {
            'material': 'db://internal/default_file_content/material/default.mtl',
            'effect': 'db://internal/default_file_content/effect/default.effect',
            'scene': 'db://internal/default_file_content/scene/default.scene',
            'prefab': 'db://internal/default_file_content/prefab/default.prefab',
            'animation-clip': 'db://internal/default_file_content/animation-clip/default.anim',
            'render-texture': 'db://internal/default_file_content/render-texture/default.rt',
            'physics-material': 'db://internal/default_file_content/physics-material/default.pmtl',
            'animation-graph': 'db://internal/default_file_content/animation-graph/default.animgraph',
            'animation-graph-variant': 'db://internal/default_file_content/animation-graph-variant/default.animgraphvari',
            'animation-mask': 'db://internal/default_file_content/animation-mask/default.animask',
            'auto-atlas': 'db://internal/default_file_content/auto-atlas/default.pac',
            'effect-header': 'db://internal/default_file_content/effect-header/chunk',
            'label-atlas': 'db://internal/default_file_content/label-atlas/default.labelatlas',
            'terrain': 'db://internal/default_file_content/terrain/default.terrain'
        };

        const assetOptions: AssetOperationOption = {
            overwrite: args.options?.overwrite ?? false,
            rename: args.options?.rename ?? false
        };

        if (type === 'folder' || type === 'typescript') {
            let content: string | null = null;
            if (type === 'typescript') {
                const currentExtName = extname(targetPath);
                if (currentExtName !== '.ts') {
                    targetPath = currentExtName ? targetPath.slice(0, -currentExtName.length) : targetPath;
                    targetPath += '.ts';
                }
                const className = basename(targetPath.slice('db://'.length), '.ts');
                content = this.generateTypescriptClassTemplate(className);
            }

            const result = await Editor.Message.request('asset-db', 'create-asset', targetPath, content, assetOptions);
            if (!result) {
                throw new Error(`Failed to create folder at ${targetPath}`);
            } else {
                return { reference: { id: result.uuid, type: type } };
            }
        }

        const source = presetMap[type];
        if (!source) {
            throw new Error(`Unknown asset preset type: ${type}`);
        }

        if (extname(targetPath) === '' && type !== 'folder') {
            targetPath += type == 'chunk' ? '.chunk' : extname(presetMap[type]);
        }

        const assetInfo = await Editor.Message.request('asset-db', 'copy-asset', source, targetPath, assetOptions);
        if (!assetInfo) {
            throw new Error(`Failed to create asset at ${targetPath}`);
        } else {
            return { reference: { id: assetInfo.uuid, type: assetInfo.type } };
        }
    }

    @utcpTool(
        'assetImport',
        'Import an external file as an asset into the project. Path must end with the extension. Returns reference to the new asset.',
        {
            type: 'object',
            properties: {
                sourceFilesystemPath: { type: 'string', description: 'Source filesystem path of the file to import' },
                targetAssetPath: { type: 'string', description: 'Target path in the asset database' },
                imageType: { type: 'string', enum: ['raw', 'texture', 'normal-map', 'sprite-frame', 'texture-cube'], description: 'For image files, specify how to import them' },
                options: { type: 'object', properties: { overwrite: { type: 'boolean' }, rename: { type: 'boolean' } }, description: 'Additional options for the operation' },
            },
            required: ['sourceFilesystemPath', 'targetAssetPath']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST", ['asset', 'import', 'file', 'external', 'image']
    )
    async assetImport(args: { sourceFilesystemPath: string, targetAssetPath: string, imageType?: 'raw' | 'texture' | 'normal-map' | 'sprite-frame' | 'texture-cube', options?: { overwrite?: boolean, rename?: boolean } }): Promise<{ reference: IInstanceReference }> {
        let targetPath = normalizePath(args.targetAssetPath);

        const assetOptions: AssetOperationOption = {
            overwrite: args.options?.overwrite ?? false,
            rename: args.options?.rename ?? false
        };

        // Additional resolving for absolute path
        if (args.sourceFilesystemPath.startsWith('~')) {
            args.sourceFilesystemPath = path.join(os.homedir(), args.sourceFilesystemPath.slice(1));
        }
        args.sourceFilesystemPath = path.resolve(args.sourceFilesystemPath);
        args.sourceFilesystemPath = await fs.realpath(args.sourceFilesystemPath);

        // Checking for existing asset at target path
        let existingAssetInfo: AssetInfo | null = null;
        // If caller tries to import the same file in assets - just reimport
        if (`${Editor.Project.path}${targetPath.slice('db:/'.length)}` === args.sourceFilesystemPath) {
            await Editor.Message.request('asset-db', 'refresh-asset', targetPath);
            existingAssetInfo = await Editor.Message.request('asset-db', 'query-asset-info', targetPath);
        }

        const assetInfo = existingAssetInfo ? existingAssetInfo :
            await Editor.Message.request('asset-db', 'import-asset', args.sourceFilesystemPath, targetPath, assetOptions);
        if (!assetInfo) {
            throw new Error(`Failed to import asset to ${targetPath}`);
        } else {
            if (assetInfo.extends && assetInfo.importer === 'image' && args.imageType) {
                // Handle image type override
                const meta = await Editor.Message.request('asset-db', 'query-asset-meta', assetInfo.uuid);
                if (meta && meta.userData) {
                    let typeToSet: string = args.imageType;
                    if (typeToSet === 'normal-map') {
                        typeToSet = 'normal map';
                    }
                    if (typeToSet === 'texture-cube') {
                        typeToSet = 'texture cube';
                    }
                    meta.userData.type = typeToSet;
                    await Editor.Message.request('asset-db', 'save-asset-meta', assetInfo.uuid, JSON.stringify(meta));
                }
            }

            return { reference: { id: assetInfo.uuid, type: assetInfo.type } };
        }
    }

    @utcpTool(
        'assetOperate',
        'Perform operations on assets (move, copy, delete, open). Returns reference to the affected asset (for delete/open returns the source asset reference).',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['move', 'copy', 'delete', 'open', 'refresh', 'reimport'] },
                reference: InstanceReferenceSchema,
                targetAssetPath: { type: 'string', description: 'Target path (for move/copy/import)' },
                options: { type: 'object', properties: { overwrite: { type: 'boolean' }, rename: { type: 'boolean' } }, description: 'Additional options for the operation', nullable: true },
            },
            required: ['operation', 'reference']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema }, required: ['reference'] }, "POST", ['asset', 'operate', 'move', 'copy', 'delete', 'open', 'refresh', 'reimport']
    )
    async assetOperate(args: { operation: string, reference: IInstanceReference, targetAssetPath?: string, options?: { overwrite?: boolean, rename?: boolean } }): Promise<{ reference: IInstanceReference }> {
        const assetOptions = {
            overwrite: args.options?.overwrite ?? false,
            rename: args.options?.rename ?? false
        };

        args.targetAssetPath = normalizePath(args.targetAssetPath);
        let result: AssetInfo | null = null;

        switch (args.operation) {
            case 'move':
                if (!args.targetAssetPath) {
                    throw new Error('Target is required for move');
                }

                result = await Editor.Message.request('asset-db', 'move-asset', args.reference.id, args.targetAssetPath, assetOptions);
                break;

            case 'copy':
                if (!args.targetAssetPath) {
                    throw new Error('Target is required for copy');
                }
                result = await Editor.Message.request('asset-db', 'copy-asset', args.reference.id, args.targetAssetPath, assetOptions);
                break;

            case 'delete':
                result = await Editor.Message.request('asset-db', 'delete-asset', args.reference.id);
                break;

            case 'open':
                await Editor.Message.request('asset-db', 'open-asset', args.reference.id);
                result = null;
                break;

            case 'refresh':
                await Editor.Message.request('asset-db', 'refresh-asset', args.reference.id);
                result = null;
                break;
            case 'reimport':
                await Editor.Message.request('asset-db', 'reimport-asset', args.reference.id);
                result = null;
                break;
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }

        return { reference: { id: result?.uuid ?? '', type: result?.type ?? '' } };
    }

    @utcpTool(
        'assetGetPreview',
        'Returns preview image of the asset (Prefab, Image, Model or Material is supported). IMPORTANT: To visualize the image, you must return the result of this function DIRECTLY as the final value of your code, do NOT wrap it in an object.',
        {
            type: 'object',
            properties: {
                reference: InstanceReferenceSchema,
                imageSize: { type: 'number', description: 'Size of the preview image (square)', default: 512 },
                jpegQuality: { type: 'integer', description: 'JPEG Quality of the preview image', minimum: 40, maximum: 100, default: 80 },
                transparentColor: { type: 'object', properties: { r: { type: 'integer', minimum: 0, maximum: 255 }, g: { type: 'integer', minimum: 0, maximum: 255 }, b: { type: 'integer', minimum: 0, maximum: 255 } }, required: ['r', 'g', 'b'], description: 'Background color for transparent images in RGB format' }
            },
            required: ['reference']
        },
        Base64ImageSchema, "GET", ['asset', 'preview', 'screenshot']
    )
    async assetGetPreview(args: { reference: IInstanceReference, imageSize?: number, jpegQuality?: number, transparentColor?: { r: number, g: number, b: number } }): Promise<IBase64Image> {
        const info = await Editor.Message.request('asset-db', 'query-asset-info', args.reference.id);
        if (!info) {
            throw new Error(`Asset ${args.reference.id} not found.`);
        }
        if (!info.importer) {
            throw new Error(`Asset ${args.reference.id} has no importer and cannot be previewed.`);
        }

        args.imageSize = args.imageSize || 512;
        args.jpegQuality = args.jpegQuality || 80;
        args.transparentColor = args.transparentColor || { r: 0, g: 0, b: 0 };
        let importer = info.importer;

        const supportedImporters = [
            'erp-texture-cube',
            'image',
            'sprite-frame',
            'texture',
            'fbx',
            'gltf',
            'gltf-mesh',
            'prefab',
            'material',
            'spine',
            'gltf-skeleton',
            'scene'
        ];

        if (!supportedImporters.includes(importer)) {
            throw new Error(`Asset preview not supported for asset type: ${info.type}`);
        }

        if (importer === 'fbx' || importer === 'gltf') {
            const mesh = Object.values(info.subAssets).find((sub: any) => sub.importer === 'gltf-mesh');
            if (!mesh) {
                throw new Error(`Asset ${args.reference.id} has no gltf-mesh sub-asset for preview.`);
            }
            args.reference.id = mesh.uuid;
            importer = 'gltf-mesh';
        }

        let sourcePath: string | null = null;

        if (importer === 'gltf-mesh' || importer === 'mesh') {
            sourcePath = (await Editor.Message.request('asset-db', 'query-asset-thumbnail', args.reference.id, "origin") as any).value;
        } else if (['erp-texture-cube', 'image', 'sprite-frame', 'texture'].includes(importer)) {
            let fileUuid = args.reference.id;
            if (args.reference.id.includes('@')) {
                fileUuid = args.reference.id.split('@')[0];
            }

            const fileInfo = await Editor.Message.request('asset-db', 'query-asset-info', fileUuid);
            if (fileInfo && fileInfo.file) {
                sourcePath = fileInfo.file;
            }
        }

        if (sourcePath && fs.existsSync(sourcePath)) {
            try {
                const image = sharp(sourcePath);
                const metadata = await image.metadata();
                const requestedSize = args.imageSize || 512;
                let processed = image;

                if (
                    (metadata.width && metadata.width > requestedSize) ||
                    (metadata.height && metadata.height > requestedSize)
                ) {
                    processed = processed.resize(requestedSize, requestedSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
                }

                let buffer;
                if ((metadata.format === 'png' || metadata.hasAlpha)) {
                    buffer = await processed.flatten({ background: args.transparentColor })
                        .jpeg({ quality: args.jpegQuality || 80 })
                        .toBuffer();
                } else {
                    buffer = await processed
                        .jpeg({ quality: args.jpegQuality || 80 })
                        .toBuffer();
                }
                return { type: "image", data: buffer.toString('base64'), mimeType: "image/jpeg" };
            } catch (e) {
                console.error(`Failed to process image from ${sourcePath} with sharp:`, e);
            }
        }

        // Open panel to ensure renderer process is alive
        await Editor.Panel.openBeside('scene', `${packageJSON.name}.preview`);

        let base64Image: string;
        try {
            // Request generation
            base64Image = await Editor.Message.request(packageJSON.name, 'generate-preview', args.reference.id, args.imageSize || 512, args.imageSize || 512, (args.jpegQuality || 80) / 100);
        } finally {
            // Close panel
            await Editor.Panel.close(`${packageJSON.name}.preview`);
        }

        if (!base64Image) {
            throw new Error(`Failed to generate preview for asset ${args.reference.id}.`);
        }
        return { type: "image", data: base64Image, mimeType: "image/jpeg" };
    }

    private generateTypescriptClassTemplate(className: string): string {
        return `import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('${className}')
export class ${className} extends Component {
    start() {

    }

    update(deltaTime: number) {
        
    }
}`;
    }
}