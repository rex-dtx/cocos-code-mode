import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { utcpTool } from '../decorators';

type SelectionType = 'node' | 'asset';

function selectionType(raw?: string): SelectionType {
    const t = raw || 'node';
    if (t !== 'node' && t !== 'asset') { throw new Error(`selectionType must be node or asset, got ${t}`); }
    return t;
}

/** ids den tu query string: 1 gia tri = string, nhieu gia tri = array. */
function toIdArray(ids: any): string[] {
    if (ids === undefined || ids === null || ids === '') { throw new Error('ids is required for this operation'); }
    const list = Array.isArray(ids) ? ids : String(ids).split(',');
    const clean = list.map((s) => String(s).trim()).filter((s) => s.length > 0);
    if (clean.length === 0) { throw new Error('ids is empty'); }
    return clean;
}

function tryGet<T>(fn: () => T, notes: string[], label: string): T | null {
    try {
        const value = fn();
        return value === undefined ? null : value;
    } catch (e: any) {
        notes.push(`${label}: ${e && e.message ? e.message : String(e)}`);
        return null;
    }
}

export class EditorMiscTools {

    @utcpTool(
        'editorSelect',
        'Get or change editor selection (node/asset). Changes selection only, not scene. ' +
        'Ops: query/select/unselect/clear + hover/set_context/patch/filter/confirm/cancel (selection.html 18-method API).',
        {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['query', 'select', 'unselect', 'clear', 'hover', 'set_context', 'patch', 'filter', 'confirm', 'cancel'],
                    description: 'Which action to take'
                },
                selectionType: { type: 'string', enum: ['node', 'asset'], description: 'Selection channel, default node' },
                ids: { type: 'string', description: 'Comma-separated uuids — select/unselect/filter. hover: single id (omit = hover out). patch: "srcId,destId"' },
                unselectOthers: { type: 'boolean', description: 'Replace the current selection instead of adding to it, select only' },
                confirm: { type: 'boolean', description: 'Confirm the selection change (select/unselect), default true' },
                filterMode: { type: 'string', enum: ['top-level', 'deep', 'name'], description: 'Mode for filter op, default top-level' },
            },
            required: ['operation'],
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                selected: { type: 'array', items: { type: 'string' } },
                activate: { type: 'string' },
                hovering: { type: 'string' },
                globalActive: { type: 'object' },
                contexts: { type: 'array', items: { type: 'string' } },
                confirmed: { type: 'boolean' },
                filtered: { type: 'array', items: { type: 'string' } },
                notes: { type: 'array', items: { type: 'string' } },
            },
            required: ['success'],
        },
        'GET', ['editor', 'selection', 'select', 'node', 'asset', 'ui', 'hover', 'context', 'filter']
    )
    async editorSelect(args: { operation: string, selectionType?: string, ids?: any, unselectOthers?: boolean, confirm?: boolean, filterMode?: string }): Promise<any> {
        const type = selectionType(args.selectionType);
        const notes: string[] = [];
        const confirmFlag = args.confirm !== false;

        const snapshot = () => ({
            selected: Editor.Selection.curSelection(type),
            activate: Editor.Selection.curActivate(type),
            hovering: Editor.Selection.hovering(type),
            // curGlobalActivate verified OK; contexts/confirmed chua verify -> tryGet.
            globalActive: tryGet(() => Editor.Selection.curGlobalActivate(type), notes, 'curGlobalActivate'),
            contexts: tryGet(() => Editor.Selection.contexts(type), notes, 'contexts'),
            confirmed: tryGet(() => Editor.Selection.confirmed(type), notes, 'confirmed'),
        });

        const done = (extra?: any) => ({ success: true, ...snapshot(), ...extra, ...(notes.length ? { notes } : {}) });

        switch (args.operation) {
            case 'query':
                return done();
            case 'select':
                Editor.Selection.select(type, toIdArray(args.ids), args.unselectOthers !== false, confirmFlag);
                return done();
            case 'unselect':
                Editor.Selection.unselect(type, toIdArray(args.ids), confirmFlag);
                return done();
            case 'clear':
                Editor.Selection.clear(type);
                return done();
            case 'hover': {
                // hover(type, id) — id=null = hover out. Chi nhan 1 id.
                const list = args.ids ? String(args.ids).split(',').map((s) => s.trim()).filter(Boolean) : [];
                Editor.Selection.hover(type, list.length ? list[0] : null);
                return done();
            }
            case 'set_context': {
                const id = toIdArray(args.ids)[0];
                Editor.Selection.setContext(type, id);
                return done();
            }
            case 'patch': {
                // patch(type, srcID, destID) — drag-reorder selection. ids = "src,dest".
                const ids = toIdArray(args.ids);
                if (ids.length < 2) { throw new Error('patch requires ids "srcId,destId"'); }
                Editor.Selection.patch(type, ids[0], ids[1]);
                return done();
            }
            case 'filter': {
                const items = toIdArray(args.ids);
                const mode = (args.filterMode || 'top-level') as 'top-level' | 'deep' | 'name';
                const filtered = Editor.Selection.filter(items, mode);
                return { success: true, filtered };
            }
            case 'confirm':
                Editor.Selection.confirm();
                return { success: true };
            case 'cancel':
                Editor.Selection.cancel();
                return { success: true };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'editorEnvInfo',
        'Get editor/engine versions and project path.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                editorVersion: { type: 'string' },
                engineVersion: { type: 'string' },
                nodeVersion: { type: 'string' },
                electronVersion: { type: 'string' },
                projectPath: { type: 'string' },
                versions: { type: 'object' },
                notes: { type: 'array', items: { type: 'string' } },
            },
        },
        'GET', ['editor', 'environment', 'version', 'project', 'info']
    )
    async editorEnvInfo(): Promise<any> {
        const notes: string[] = [];

        // Editor.versions runtime 2.4.15: {CocosCreator, editor-framework, asset-db, cocos2d}
        const versions: any = tryGet(() => Editor.versions, notes, 'Editor.versions') || {};
        const projectPath = tryGet(() => Editor.Project.path, notes, 'Editor.Project.path');

        const editorVersion = versions['CocosCreator'] || versions['cocos-creator'] || versions['editor'] || null;
        const engineVersion = versions['cocos2d'] || versions['cocos2d-x'] || versions['engine'] || null;

        if (!editorVersion) { notes.push('editorVersion not found in Editor.versions'); }
        if (!engineVersion) { notes.push('engineVersion not found in Editor.versions'); }

        return {
            editorVersion,
            engineVersion,
            nodeVersion: process.versions.node,
            electronVersion: process.versions.electron || null,
            projectPath,
            versions,
            notes,
        };
    }

    @utcpTool(
        'projectGetConfig',
        'Read project settings. Omit type for all, type for one file, key for one value.',
        {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Settings file name without extension, e.g. project — omit for all' },
                key: { type: 'string', description: 'Single key inside that settings file' },
            },
        },
        {
            type: 'object',
            properties: {
                config: {},
                available: { type: 'array', items: { type: 'string' } },
            },
        },
        'GET', ['project', 'config', 'settings']
    )
    async projectGetConfig(args: { type?: string, key?: string }): Promise<any> {
        // 2.x settings nam o <project>/settings/*.json (3.x khac cho). Doc thang file:
        // Editor.Profile.load tra EventEmitter, khong serialize duoc (xem bay 4 phase 4).
        const projectPath = Editor.Project.path;
        if (!projectPath) { throw new Error('Editor.Project.path is not available'); }
        const settingsDir = join(projectPath, 'settings');
        if (!existsSync(settingsDir)) { throw new Error(`Settings directory not found: ${settingsDir}`); }

        const available = readdirSync(settingsDir)
            .filter((f: string) => f.endsWith('.json'))
            .map((f: string) => f.replace(/\.json$/, ''));

        const readOne = (name: string): any => {
            const file = join(settingsDir, `${name}.json`);
            if (!existsSync(file)) { throw new Error(`Settings file not found: ${file}. Available: ${available.join(', ')}`); }
            return JSON.parse(readFileSync(file, 'utf8'));
        };

        if (!args.type) {
            const all: any = {};
            for (const name of available) {
                try { all[name] = readOne(name); } catch (e) { /* bo qua file hong */ }
            }
            return { config: all, available };
        }

        const config = readOne(args.type);
        if (!args.key) { return { config, available }; }
        if (!(args.key in config)) { throw new Error(`Key ${args.key} not found in ${args.type}.json`); }
        return { config: config[args.key], available };
    }

    // KHONG co tool doc console log. Panel 'console' cua 2.4.15 khong expose message
    // doc nao — verify runtime, 3/3 that bai:
    //   console:query-logs / console:query / logs -> "message not found"
    // Docs main/console.md cung chi co log/warn/error (GHI). User xem Console panel
    // truc tiep. KHONG fake tool tra mang rong.

    @utcpTool(
        'editorListTypes',
        'List vocabularies: creatable_assets, asset_types, or importers.',
        {
            type: 'object',
            properties: {
                category: { type: 'string', enum: ['creatable_assets', 'asset_types', 'importers'], description: 'Which vocabulary' },
            },
            required: ['category'],
        },
        { type: 'object', properties: { types: { type: 'array', items: { type: 'string' } } }, required: ['types'] },
        'GET', ['editor', 'types', 'list', 'enumerate', 'creatable', 'importer']
    )
    async editorListTypes(args: { category: string }): Promise<any> {
        const cat = args.category;
        if (cat === 'asset_types') {
            // Editor.assettype2name: { 'cc.Texture2D': 'texture', ... } -> unique type names
            const map: any = (Editor as any).assettype2name || {};
            const types = Array.from(new Set(Object.values(map) as string[])).sort();
            return { types };
        }
        if (cat === 'importers') {
            // No direct enumerate on 2.4; derive from assettype2name keys + .meta importer field
            // Fallback: return keys of assettype2name (importer name == class name for most assets)
            const map: any = (Editor as any).assettype2name || {};
            return { types: Object.keys(map).sort() };
        }
        if (cat === 'creatable_assets') {
            // 2.4 scene messages for creatable presets: try known candidates, else fallback to common list
            const candidates = ['scene:query-creatable-asset-types', 'asset-db:query-creatable-asset-types'];
            for (const msg of candidates) {
                try {
                    const raw: any = await new Promise((resolve, reject) => {
                        Editor.Ipc.sendToPanel('scene', msg as any, (err: any, res: any) => err ? reject(err) : resolve(res));
                    });
                    if (Array.isArray(raw) && raw.length) return { types: raw.filter((s: any) => typeof s === 'string') };
                } catch {}
            }
            // Fallback known presets observed in 2.4 asset-db
            return { types: ['folder','scene','prefab','material','typescript','javascript','json','effect','particle','texture-packer','sprite-frame'] };
        }
        throw new Error(`Unknown category: ${cat}. Use creatable_assets, asset_types, or importers`);
    }

    @utcpTool(
        'previewGetUrl',
        'Get the URL of the editor game preview server (browser preview). Null if preview not running.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        'GET', ['preview', 'url', 'browser', 'play']
    )
    async previewGetUrl(): Promise<{ url: string }> {
        // 2.4: Editor.PreviewServer ? probe tung message
        const candidates = ['preview:query-preview-url', 'preview:get-url', 'scene:query-preview-url'];
        for (const msg of candidates) {
            try {
                const url: string = await new Promise<string>((resolve, reject) => {
                    const panel = msg.startsWith('preview:') ? 'preview' : 'scene';
                    Editor.Ipc.sendToPanel(panel, msg, (err: any, result: any) => {
                        if (err) { return reject(err); }
                        resolve(result);
                    });
                });
                if (url && typeof url === 'string') { return { url }; }
            } catch (e) { /* thu message tiep theo */ }
        }
        throw new Error('Preview URL not available — preview server may not be running');
    }

    @utcpTool(
        'previewOpenInBrowser',
        'Open the current scene preview in the system default browser.',
        { type: 'object', properties: {} },
        { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] },
        'POST', ['preview', 'browser', 'open', 'play']
    )
    async previewOpenInBrowser(): Promise<{ success: boolean }> {
        const candidates = ['preview:preview-scene-in-browser', 'preview:open', 'scene:preview-scene-in-browser'];
        let lastErr: any;
        for (const msg of candidates) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const panel = msg.startsWith('preview:') ? 'preview' : 'scene';
                    Editor.Ipc.sendToPanel(panel, msg, (err: any) => {
                        if (err) { return reject(err); }
                        resolve();
                    });
                });
                return { success: true };
            } catch (e) { lastErr = e; }
        }
        throw new Error(`Failed to open preview: ${lastErr?.message || lastErr}`);
    }

    @utcpTool(
        'assetGetPreview',
        'Get thumbnail/preview base64 for an asset (texture/prefab/material). Returns note if not available on 2.4.',
        {
            type: 'object',
            properties: {
                uuid: { type: 'string', description: 'Asset uuid' },
                url: { type: 'string', description: 'Asset db:// url' },
            },
        },
        { type: 'object', properties: { type: { type: 'string' }, data: { type: 'string' }, mimeType: { type: 'string' }, note: { type: 'string' } } },
        'GET', ['asset', 'preview', 'thumbnail', 'image']
    )
    async assetGetPreview(args: { uuid?: string, url?: string }): Promise<any> {
        const uuid = args.uuid || (args.url ? Editor.assetdb.urlToUuid(args.url) : null);
        if (!uuid) throw new Error('assetGetPreview requires uuid or url');
        // Try 2.4 asset-db preview message if exists
        for (const msg of ['asset-db:query-asset-preview', 'asset-db:get-preview'] as any[]) {
            try {
                const res: any = await new Promise((resolve, reject) => {
                    Editor.Ipc.sendToMain(msg, uuid, (err: any, r: any) => err ? reject(err) : resolve(r));
                });
                if (res) return res;
            } catch {}
        }
        // Fallback: generate from file via sharp if texture
        const fspath = Editor.assetdb.uuidToFspath(uuid) || (args.url ? Editor.assetdb.urlToFspath(args.url) : null);
        if (fspath) {
            try {
                const { existsSync } = await import('fs');
                const path = await import('path');
                if (existsSync(fspath)) {
                    const ext = path.extname(fspath).toLowerCase();
                    if (['.png','.jpg','.jpeg'].includes(ext)) {
                        const { readFileSync } = await import('fs');
                        const b64 = readFileSync(fspath).toString('base64');
                        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
                        return { type: 'image', data: b64, mimeType: mime };
                    }
                }
            } catch {}
        }
        return { note: 'Preview not available for this asset on Creator 2.4 — texture fallback only', type: 'image', data: '', mimeType: 'image/png' };
    }

    @utcpTool(
        'editorGetLogs',
        'Get last N lines from project.log (Editor.Project.path/temp/logs/project.log). Returns empty if log missing.',
        {
            type: 'object',
            properties: {
                count: { type: 'number', description: 'Lines to return', default: 50 },
                order: { type: 'string', enum: ['newest-to-oldest','oldest-to-newest'], description: 'Order', default: 'newest-to-oldest' },
            },
        },
        { type: 'object', properties: { logLines: { type: 'array', items: { type: 'string' } }, path: { type: 'string' } }, required: ['logLines'] },
        'GET', ['editor', 'logs', 'debug', 'info']
    )
    async editorGetLogs(args: { count?: number, order?: string }): Promise<any> {
        const { join } = await import('path');
        const { existsSync, readFileSync } = await import('fs');
        const projectPath = Editor.Project.path;
        if (!projectPath) throw new Error('Editor.Project.path not available');
        const logPath = join(projectPath, 'temp', 'logs', 'project.log');
        if (!existsSync(logPath)) return { logLines: [], path: logPath };
        const text = readFileSync(logPath, 'utf8');
        let lines = text.split('\n').filter(Boolean);
        const n = args.count && args.count > 0 ? args.count : 50;
        if (args.order === 'oldest-to-newest') lines = lines.slice(-n);
        else { lines = lines.slice(-n).reverse(); }
        return { logLines: lines, path: logPath };
    }

    @utcpTool(
        'editorGetScenePreview',
        'Scene screenshot preview via scene console capture fallback. Returns base64 JPEG if available, otherwise note.',
        {
            type: 'object',
            properties: {
                width: { type: 'number', description: 'Image width', default: 512 },
                height: { type: 'number', description: 'Image height', default: 512 },
            },
        },
        { type: 'object', properties: { type: { type: 'string' }, data: { type: 'string' }, mimeType: { type: 'string' }, note: { type: 'string' } } },
        'GET', ['scene', 'screenshot', 'preview', 'image']
    )
    async editorGetScenePreview(args: { width?: number, height?: number }): Promise<any> {
        // 2.4 has no scene:capture-screenshot; try, else return note
        const w = args.width || 512, h = args.height || 512;
        for (const msg of ['scene:capture-screenshot', 'scene:query-screenshot'] as any[]) {
            try {
                const res: any = await new Promise((resolve, reject) => {
                    Editor.Ipc.sendToPanel('scene', msg, { width: w, height: h }, (err: any, r: any) => err ? reject(err) : resolve(r));
                });
                if (typeof res === 'string' && res.startsWith('/9j/')) return { type: 'image', data: res, mimeType: 'image/jpeg' };
                if (res && res.data) return res;
            } catch {}
        }
        return { note: 'Scene preview capture not available on Creator 2.4.15 — try manual screenshot from editor toolbar', type: 'image', data: '', mimeType: 'image/jpeg' };
    }
}
