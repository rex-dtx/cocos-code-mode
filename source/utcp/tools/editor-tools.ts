import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import * as fs from 'fs';
import * as path from 'path';
import { Base64ImageSchema, IBase64Image, ISuccessIndicator, SuccessIndicatorSchema, InstanceReferenceSchema, IInstanceReference } from '../schemas';

export class EditorTools {

    @utcpTool(
        'editorEnvInfo',
        'Get editor/engine version, paths, and project filesystem path.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                editor: { type: 'string', description: 'Editor (Creator) version' },
                engineVersion: { type: 'string' },
                enginePath: { type: 'string' },
                nativeVersion: { type: 'string' },
                nativePath: { type: 'string' },
                projectPath: { type: 'string', description: 'Filesystem path of the currently opened project' }
            },
            required: ['editor', 'engineVersion', 'projectPath']
        }, "GET", ['editor', 'env', 'info', 'version', 'engine', 'project']
    )
    async editorEnvInfo(): Promise<{ editor: string, engineVersion: string, enginePath?: string, nativeVersion?: string, nativePath?: string, projectPath: string }> {
        const info = await Editor.Message.request('engine', 'query-info');
        if (!info) {
            throw new Error('Failed to query engine info');
        }
        return {
            editor: info.editor,
            engineVersion: info.version,
            enginePath: info.path,
            nativeVersion: info.nativeVersion,
            nativePath: info.nativePath,
            projectPath: Editor.Project.path
        };
    }

    @utcpTool(
        'editorViewport',
        'Control scene viewport: focus camera, toggle 2D/grid/gizmos, query state, align view or nodes.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['focus', 'set_2d_mode', 'set_grid_visible', 'set_icon_gizmo_3d', 'set_icon_gizmo_size', 'set_gizmo_tool', 'set_gizmo_pivot', 'set_gizmo_coordinate', 'query_gizmo', 'query_viewport', 'align_view_to_selected_node', 'align_selected_node_to_view'] },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For focus: nodes to focus the camera on' },
                enabled: { type: 'boolean', description: 'For set_2d_mode / set_grid_visible / set_icon_gizmo_3d' },
                size: { type: 'number', description: 'For set_icon_gizmo_size: on-screen size of component icon gizmos' },
                gizmoTool: { type: 'string', enum: ['move', 'rotate', 'scale', 'rect'], description: 'For set_gizmo_tool' },
                gizmoPivot: { type: 'string', enum: ['center', 'pivot'], description: 'For set_gizmo_pivot: transform around the bounding-box center or the node pivot' },
                gizmoCoordinate: { type: 'string', enum: ['local', 'global'], description: 'For set_gizmo_coordinate: gizmo axes in node-local or world space' }
            },
            required: ['operation']
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                error: { type: 'string' },
                gizmoTool: { type: 'string' },
                gizmoPivot: { type: 'string' },
                gizmoCoordinate: { type: 'string' },
                is2D: { type: 'boolean' },
                gridVisible: { type: 'boolean' },
                iconGizmo3D: { type: 'boolean' },
                iconGizmoSize: { type: 'number' }
            },
            required: ['success']
        }, "POST", ['editor', 'viewport', 'camera', 'focus', '2d', 'grid', 'gizmo', 'pivot', 'coordinate', 'frame', 'align', 'icon', 'query', 'state']
    )
    async editorViewport(args: { operation: string, references?: IInstanceReference[], enabled?: boolean, size?: number, gizmoTool?: string, gizmoPivot?: string, gizmoCoordinate?: string }):
        Promise<ISuccessIndicator & { gizmoTool?: string, gizmoPivot?: string, gizmoCoordinate?: string, is2D?: boolean, gridVisible?: boolean, iconGizmo3D?: boolean, iconGizmoSize?: number }> {
        switch (args.operation) {
            case 'focus': {
                const uuids = (args.references || []).map((r: IInstanceReference) => r.id).filter((id: string) => !!id);
                if (uuids.length === 0) {
                    throw new Error('references required for focus');
                }
                await Editor.Message.request('scene', 'focus-camera', uuids);
                return { success: true };
            }
            case 'set_2d_mode':
                await Editor.Message.request('scene', 'change-is2D', !!args.enabled);
                return { success: true };
            case 'set_grid_visible':
                await Editor.Message.request('scene', 'set-grid-visible', !!args.enabled);
                return { success: true };
            case 'set_icon_gizmo_3d':
                await Editor.Message.request('scene', 'set-icon-gizmo-3d', !!args.enabled);
                return { success: true };
            case 'set_icon_gizmo_size':
                if (typeof args.size !== 'number') {
                    throw new Error('size required for set_icon_gizmo_size');
                }
                await Editor.Message.request('scene', 'set-icon-gizmo-size', args.size);
                return { success: true };
            case 'set_gizmo_tool':
                if (!args.gizmoTool) {
                    throw new Error('gizmoTool required for set_gizmo_tool');
                }
                await Editor.Message.request('scene', 'change-gizmo-tool', args.gizmoTool);
                return { success: true };
            case 'set_gizmo_pivot':
                if (!args.gizmoPivot) {
                    throw new Error('gizmoPivot required for set_gizmo_pivot');
                }
                await Editor.Message.request('scene', 'change-gizmo-pivot', args.gizmoPivot);
                return { success: true };
            case 'set_gizmo_coordinate':
                if (!args.gizmoCoordinate) {
                    throw new Error('gizmoCoordinate required for set_gizmo_coordinate');
                }
                await Editor.Message.request('scene', 'change-gizmo-coordinate', args.gizmoCoordinate);
                return { success: true };
            case 'query_gizmo':
                return {
                    success: true,
                    gizmoTool: await Editor.Message.request('scene', 'query-gizmo-tool-name'),
                    gizmoPivot: await Editor.Message.request('scene', 'query-gizmo-pivot'),
                    gizmoCoordinate: await Editor.Message.request('scene', 'query-gizmo-coordinate')
                };
            case 'query_viewport':
                return {
                    success: true,
                    is2D: !!(await Editor.Message.request('scene', 'query-is2D')),
                    gridVisible: !!(await Editor.Message.request('scene', 'query-is-grid-visible')),
                    iconGizmo3D: !!(await Editor.Message.request('scene', 'query-is-icon-gizmo-3d')),
                    iconGizmoSize: await Editor.Message.request('scene', 'query-icon-gizmo-size')
                };
            case 'align_view_to_selected_node':
                // Moves the camera to frame the currently selected node(s) - select first via editorSelect
                await Editor.Message.request('scene', 'align-view-with-node');
                return { success: true };
            case 'align_selected_node_to_view':
                // Aligns the currently selected node(s) to the current camera view - select first via editorSelect
                await Editor.Message.request('scene', 'align-with-view');
                return { success: true };
            default:
                throw new Error(`Unknown viewport operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'editorSelect',
        'Select, deselect, clear or query editor selection for nodes or assets. Also hover/update.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['select', 'unselect', 'clear', 'query', 'select_all', 'hover', 'update'] },
                selectionType: { type: 'string', enum: ['node', 'asset'], description: 'Selection domain', default: 'node' },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For select/unselect/update/hover: the items (hover = 0..1, null = hover-out)' }
            },
            required: ['operation']
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                selected: { type: 'array', items: { type: 'string' }, description: 'Currently selected uuids after the operation' },
                lastSelected: { type: 'string' },
                lastSelectedType: { type: 'string', description: 'Type of the last selected element' }
            },
            required: ['success']
        }, "POST", ['editor', 'select', 'selection', 'all', 'hierarchy', 'inspector', 'highlight', 'hover', 'update']
    )
    async editorSelect(args: { operation: string, selectionType?: string, references?: IInstanceReference[] }):
        Promise<{ success: boolean, selected?: string[], lastSelected?: string, lastSelectedType?: string }> {
        const type = args.selectionType === 'asset' ? 'asset' : 'node';
        const uuids = (args.references || []).map((r: IInstanceReference) => r.id).filter((id: string) => !!id);

        switch (args.operation) {
            case 'select': {
                if (uuids.length === 0) {
                    throw new Error('references required for select');
                }
                Editor.Selection.select(type, uuids.length === 1 ? uuids[0] : uuids);
                return { success: true, selected: Editor.Selection.getSelected(type) };
            }
            case 'unselect': {
                if (uuids.length === 0) {
                    throw new Error('references required for unselect');
                }
                Editor.Selection.unselect(type, uuids.length === 1 ? uuids[0] : uuids);
                return { success: true, selected: Editor.Selection.getSelected(type) };
            }
            case 'clear':
                Editor.Selection.clear(type);
                return { success: true, selected: [] };
            case 'select_all':
                if (type !== 'node') {
                    throw new Error('select_all only supports selectionType "node"');
                }
                await Editor.Message.request('scene', 'select-all-nodes');
                return { success: true, selected: Editor.Selection.getSelected('node') };
            case 'hover': {
                // 3.7: hover(type, uuid?) — uuid omitted/null = hover-out, emits selection:hover
                const uuid = uuids.length ? uuids[0] : undefined;
                (Editor.Selection as any).hover(type, uuid);
                return { success: true, selected: Editor.Selection.getSelected(type) };
            }
            case 'update': {
                if (uuids.length === 0) {
                    throw new Error('references required for update');
                }
                (Editor.Selection as any).update(type, uuids);
                return { success: true, selected: Editor.Selection.getSelected(type) };
            }
            case 'query':
                return {
                    success: true,
                    selected: Editor.Selection.getSelected(type),
                    lastSelected: Editor.Selection.getLastSelected(type) || undefined,
                    lastSelectedType: (Editor.Selection as any).getLastSelectedType?.() || undefined
                };
            default:
                throw new Error(`Unknown selection operation: ${args.operation}`);
        }
    }

    /** @deprecated use editorQuery({ category: 'creatable_assets'|'asset_types'|'importers' }) — not registered, kept for delegation */
    async editorListTypes(args: { category: string }): Promise<{ types: string[] }> {
        let raw: any;
        switch (args.category) {
            case 'creatable_assets':
                raw = await Editor.Message.request('scene', 'query-creatable-asset-types');
                break;
            case 'asset_types':
                raw = await Editor.Message.request('asset-db', 'query-all-asset-types');
                break;
            case 'importers':
                raw = await Editor.Message.request('asset-db', 'query-all-importer');
                break;
            default:
                throw new Error(`Unknown type category: ${args.category}`);
        }
        if (!raw) {
            return { types: [] };
        }
        // Result shape of these runtime messages is not typed: string[], object[],
        // or a record (which may be name-keyed OR id-keyed with the name in the value).
        const pickName = (item: any): string | undefined =>
            typeof item === 'string' ? item : (item?.name || item?.type || item?.extname);
        let list: any[];
        if (Array.isArray(raw)) {
            list = raw;
        } else {
            const fromValues = Object.values(raw).map(pickName).filter((n): n is string => !!n);
            list = fromValues.length > 0 ? fromValues : Object.keys(raw);
        }
        return { types: list.map(pickName).filter((name): name is string => !!name) };
    }

    /** @deprecated use editorQuery({ category }) — not registered, kept for delegation */
    async editorIntrospect(args: { category: string, enumPath?: string, className?: string, reference?: IInstanceReference }):
        Promise<{ sceneMode?: string, ready?: boolean, values?: Array<{ name?: string, value?: any }>, scriptName?: string, scriptCid?: string, hasScript?: boolean, result?: any }> {
        // Enumerator / layer results are {name, value} lists but the exact item shape is
        // not guaranteed across versions - normalize defensively instead of asserting.
        const normalizeList = (raw: any): Array<{ name?: string, value?: any }> => {
            if (!raw) {
                return [];
            }
            const items: any[] = Array.isArray(raw) ? raw : Object.entries(raw).map(([name, value]) => ({ name, value }));
            return items.map((item: any) => typeof item === 'object' && item !== null
                ? { name: item.name ?? item.key, value: item.value }
                : { name: String(item), value: item });
        };

        switch (args.category) {
            case 'scene_mode': {
                const mode = await Editor.Message.request('scene', 'query-scene-mode');
                return { sceneMode: typeof mode === 'string' ? mode : String(mode ?? '') };
            }
            case 'ready':
                return { ready: !!(await Editor.Message.request('scene', 'query-is-ready')) };

            case 'enum_values': {
                if (!args.enumPath) {
                    throw new Error('editorIntrospect category "enum_values" requires enumPath');
                }
                const raw = await Editor.Message.request('scene', 'query-enum-list-with-path', args.enumPath);
                if (raw === null || raw === undefined) {
                    throw new Error(`No enum found at path "${args.enumPath}"`);
                }
                return { values: normalizeList(raw) };
            }
            case 'layers':
                return { values: normalizeList(await Editor.Message.request('scene', 'query-layer-builtin')) };

            case 'sorting_layers':
                return { values: normalizeList(await Editor.Message.request('scene', 'query-sorting-layer-builtin')) };

            case 'script_info': {
                if (!args.reference || !args.reference.id) {
                    throw new Error('editorIntrospect category "script_info" requires reference.id (script asset uuid)');
                }
                const name = await Editor.Message.request('scene', 'query-script-name', args.reference.id);
                const cid = await Editor.Message.request('scene', 'query-script-cid', args.reference.id);
                return {
                    scriptName: typeof name === 'string' ? name : undefined,
                    scriptCid: typeof cid === 'string' ? cid : undefined
                };
            }
            case 'has_script': {
                if (!args.className) {
                    throw new Error('editorIntrospect category "has_script" requires className');
                }
                return { hasScript: !!(await Editor.Message.request('scene', 'query-component-has-script', args.className)) };
            }
            // Typed but rarely needed — exposed so the typed audit goes to 0/2 here.
            case 'shared_settings':
                return { result: await Editor.Message.request('programming', 'query-shared-settings' as any) };
            case 'sorted_plugins': {
                const sorted = await Editor.Message.request('programming', 'query-sorted-plugins' as any);
                return { result: sorted };
            }
            default:
                throw new Error(`Unknown introspect category: ${args.category}`);
        }
    }

    /** @deprecated use sceneManage({ operation }) — not registered, kept for delegation */
    async editorOperate(args: { operation: string }): Promise<ISuccessIndicator & { reference?: IInstanceReference }> {
        switch (args.operation) {
            case 'save_scene_or_prefab':
                await Editor.Message.request('scene', 'save-scene');
                return { success: true };
            case 'save_as': {
                // Opens a save dialog in the editor; resolves to the new scene uuid or
                // undefined when the user cancels.
                const uuid = await Editor.Message.request('scene', 'save-as-scene');
                if (!uuid) {
                    throw new Error('Save as was cancelled or failed - no new scene asset was created');
                }
                return { success: true, reference: { id: uuid, type: 'cc.SceneAsset' } };
            }
            case 'close_scene_or_prefab':
                await Editor.Message.request('scene', 'close-scene');
                return { success: true };
            case 'soft_reload':
                await Editor.Message.request('scene', 'soft-reload');
                return { success: true };
            case 'play_preview':
                await Editor.Message.request('scene', 'editor-preview-set-play', true);
                return { success: true };
            case 'pause':
                await Editor.Message.request('scene', 'editor-preview-call-method', 'pause', true);
                return { success: true };
            case 'step':
                 await Editor.Message.request('scene', 'editor-preview-call-method', 'step');
                return { success: true };
            case 'stop':
                await Editor.Message.request('scene', 'editor-preview-set-play', false);
                return { success: true };
            case 'refresh':
                await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
                return { success: true };
            default:
                throw new Error(`Unknown operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'editorHistory',
        'Undo/redo last scene operation (snapshot); abort discards a pending snapshot.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['undo', 'redo', 'abort'] }
            },
            required: ['operation']
        },
        SuccessIndicatorSchema, "POST", ['editor', 'undo', 'redo', 'history', 'rollback', 'revert', 'abort', 'snapshot']
    )
    async editorHistory(args: { operation: string }): Promise<ISuccessIndicator> {
        if (args.operation === 'undo') {
            await Editor.Message.request('scene', 'undo');
        } else if (args.operation === 'redo') {
            await Editor.Message.request('scene', 'redo');
        } else if (args.operation === 'abort') {
            // Typed scene::snapshot-abort — drops the current pending snapshot so it
            // never becomes an undo step. Safe to call when nothing is pending.
            await Editor.Message.request('scene', 'snapshot-abort');
        } else {
            throw new Error(`Unknown history operation: ${args.operation}`);
        }
        return { success: true };
    }

    @utcpTool(
        'editorGetLogs',
        'Get last N editor log entries',
        {
            type: 'object',
            properties: {
                count: { type: 'number', description: 'Number of log entries to retrieve', default: 10 },
                showStack: { type: 'boolean', description: 'Return full stack trace for each log entry' },
                order: { type: 'string', enum: ['newest-to-oldest', 'oldest-to-newest'], description: 'Order of logs', default: 'newest-to-oldest' }
            },
            required: ['count', 'order']
        },
        { type: 'object', properties: { logLines: { type: 'array', items: { type: 'string' } } }, required: ['logLines'] }, "GET",  ['editor', 'logs', 'debug', 'info']
    )
    async editorGetLogs(args: { count: number, showStack: boolean, order: 'newest-to-oldest' | 'oldest-to-newest' }): Promise<{ logLines: string[] }> {
        const projectPath = Editor.Project.path;
        const logPath = path.join(projectPath, 'temp', 'logs', 'project.log');

        if (args.showStack === undefined) {
            args.showStack = false;
        }

        if (!fs.existsSync(logPath)) {
            throw new Error(`Log file not found at ${logPath}`);
        }

        const entries: string[] = [];
        const fd = fs.openSync(logPath, 'r');
        
        try {
            const stats = fs.fstatSync(fd);
            const fileSize = stats.size;
            const bufferSize = 10 * 1024; // 10KB chunks
            const buffer = Buffer.alloc(bufferSize);
            
            let position = fileSize;
            let leftover = '';
            let accumulatedBody = ''; // Text belonging to the current (bottom-most) entry being parsed
            
            const regex = /^(\d{1,2}-\d{1,2}-\d{4}\s\d{2}:\d{2}:\d{2}\s-\s(?:log|warn|error|info):\s)/;
            const timestampRegex = /^\d{1,2}-\d{1,2}-\d{4}\s\d{2}:\d{2}:\d{2}\s-\s/;
            
            let lastContent: string | null = null;
            let lastCount = 0;

            while (position > 0 && entries.length < args.count) {
                const readSize = Math.min(bufferSize, position);
                const readPos = position - readSize;
                
                fs.readSync(fd, buffer, 0, readSize, readPos);
                position -= readSize;
                
                const chunk = buffer.toString('utf-8', 0, readSize);
                const combined = chunk + leftover;
                
                // Split by newline
                const lines = combined.split(/\r?\n/);
                
                if (position > 0) {
                    leftover = lines.shift() || '';
                } else {
                    leftover = ''; // Process all
                }

                // Process lines in reverse (bottom to top of the chunk)
                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    
                    // Check if this line is a Header (Start of Entry)
                    if (regex.test(line)) {
                        let entry = line;
                        if (args.showStack && accumulatedBody.length > 0) {
                            entry += '\n' + accumulatedBody;
                        }
                        
                        const cleaned = entry.replace(timestampRegex, '');
                        
                        if (cleaned === lastContent) {
                            lastCount++;
                            entries[entries.length - 1] = `(${lastCount}) ${cleaned}`;
                        } else {
                            if (entries.length >= args.count) {
                                // Found a new group but we already have enough
                                position = 0; // Stop reading file loop
                                break; // Stop lines loop
                            }
                            lastContent = cleaned;
                            lastCount = 1;
                            entries.push(cleaned);
                        }
                        
                        accumulatedBody = ''; // Reset for the next entry (upwards)
                    } else {
                        // This identifies as body text (or empty line) belonging to the entry "above" it
                        if (args.showStack && accumulatedBody.length > 0) {
                            accumulatedBody = line + '\n' + accumulatedBody;
                        } else {
                            accumulatedBody = line;
                        }
                    }
                }
            }
            
        } finally {
            fs.closeSync(fd);
        }

        // We pushed entries in reverse order (newest first).
        if (args.order === 'oldest-to-newest') {
             return { logLines: entries.reverse() };
        } 
        
        return { logLines: entries };
    }

    // via previewManage — kept for delegation
    async editorGetScenePreview(args: { 
        imageSize?: { width: number, height: number }, 
        jpegQuality?: number, 
        cameraPosition?: { x: number, y: number, z: number }, 
        targetPosition?: { x: number, y: number, z: number },
        orthographic?: boolean,
        orthographicSize?: number
    }): Promise<IBase64Image> {

        // Callers routinely pass imageSize: 256 (the shape assetGetPreview takes).
        // That used to reach the canvas as a 0x0 resize and yield an empty "data:,".
        const rawSize: any = args.imageSize;
        const imageSize = typeof rawSize === 'number'
            ? { width: rawSize, height: rawSize }
            : (rawSize ?? { width: 512, height: 512 });

        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: packageJSON.name,
            method: 'captureScreenshot',
            args: [imageSize, args.jpegQuality ?? 80, args.cameraPosition , args.targetPosition, args.orthographic ?? false, args.orthographicSize ?? 10]
        });

        // JPEG base64 always begins /9j/. Anything else (notably "data:," from a
        // zero-sized canvas) is a failed capture masquerading as an image.
        if (typeof result !== 'string' || !result.startsWith('/9j/')) {
            throw new Error(`Scene preview capture returned no image data (got ${JSON.stringify(String(result).slice(0, 32))}). The scene view may not be rendering.`);
        }

        return { type: 'image', data: result, mimeType: 'image/jpeg' };
    }
}
