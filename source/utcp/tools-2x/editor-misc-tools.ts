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
        'Read or change what is selected in the editor. This changes the selection only, never the scene contents. Use query to learn what the user is looking at before acting.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['query', 'select', 'unselect', 'clear'], description: 'Which action to take' },
                selectionType: { type: 'string', enum: ['node', 'asset'], description: 'Selection channel, default node' },
                ids: { type: 'string', description: 'Comma-separated uuids — required for select / unselect' },
                unselectOthers: { type: 'boolean', description: 'Replace the current selection instead of adding to it, select only' },
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
            },
            required: ['success'],
        },
        'GET', ['editor', 'selection', 'select', 'node', 'asset', 'ui']
    )
    async editorSelect(args: { operation: string, selectionType?: string, ids?: any, unselectOthers?: boolean }): Promise<any> {
        const type = selectionType(args.selectionType);

        const snapshot = () => ({
            selected: Editor.Selection.curSelection(type),
            activate: Editor.Selection.curActivate(type),
            hovering: Editor.Selection.hovering(type),
        });

        switch (args.operation) {
            case 'query':
                return { success: true, ...snapshot() };
            case 'select':
                Editor.Selection.select(type, toIdArray(args.ids), args.unselectOthers !== false, true);
                return { success: true, ...snapshot() };
            case 'unselect':
                Editor.Selection.unselect(type, toIdArray(args.ids), true);
                return { success: true, ...snapshot() };
            case 'clear':
                Editor.Selection.clear(type);
                return { success: true, ...snapshot() };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'editorEnvInfo',
        'Editor version, engine version, runtime versions and project path. Fields that cannot be read come back as null with an explanation in notes, so this never fails outright.',
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
        'Read project settings. No arguments returns everything, type narrows to one settings file, type plus key returns a single value.',
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
}
