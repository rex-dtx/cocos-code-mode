import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import * as fs from 'fs';
import * as path from 'path';
import { Base64ImageSchema, IBase64Image, ISuccessIndicator, SuccessIndicatorSchema, InstanceReferenceSchema, IInstanceReference } from '../schemas';

export class EditorTools {

    @utcpTool(
        'editorEnvInfo',
        'Get info about the current editor environment: editor version, engine version and paths, native engine info, current project filesystem path.',
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
        'Control the editor scene viewport: focus camera on nodes, switch 2D/3D mode, show/hide grid, set gizmo tool, align view or nodes. Useful to frame nodes before taking a screenshot with editorGetScenePreview.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['focus', 'set_2d_mode', 'set_grid_visible', 'set_gizmo_tool', 'align_view_to_selected_node', 'align_selected_node_to_view'] },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For focus: nodes to focus the camera on' },
                enabled: { type: 'boolean', description: 'For set_2d_mode / set_grid_visible' },
                gizmoTool: { type: 'string', enum: ['move', 'rotate', 'scale', 'rect'], description: 'For set_gizmo_tool' }
            },
            required: ['operation']
        },
        SuccessIndicatorSchema, "POST", ['editor', 'viewport', 'camera', 'focus', '2d', 'grid', 'gizmo', 'frame', 'align']
    )
    async editorViewport(args: { operation: string, references?: IInstanceReference[], enabled?: boolean, gizmoTool?: string }): Promise<ISuccessIndicator> {
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
            case 'set_gizmo_tool':
                if (!args.gizmoTool) {
                    throw new Error('gizmoTool required for set_gizmo_tool');
                }
                await Editor.Message.request('scene', 'change-gizmo-tool', args.gizmoTool);
                return { success: true };
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
        'Select, deselect, clear or query the editor selection for nodes or assets. Selecting a node reveals it in the hierarchy/inspector and enables align operations in editorViewport.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['select', 'unselect', 'clear', 'query'] },
                selectionType: { type: 'string', enum: ['node', 'asset'], description: 'Selection domain', default: 'node' },
                references: { type: 'array', items: InstanceReferenceSchema, description: 'For select/unselect: the items to select or deselect' }
            },
            required: ['operation']
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                selected: { type: 'array', items: { type: 'string' }, description: 'Currently selected uuids after the operation' },
                lastSelected: { type: 'string' }
            },
            required: ['success']
        }, "POST", ['editor', 'select', 'selection', 'hierarchy', 'inspector', 'highlight']
    )
    async editorSelect(args: { operation: string, selectionType?: string, references?: IInstanceReference[] }):
        Promise<{ success: boolean, selected?: string[], lastSelected?: string }> {
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
            case 'query':
                return {
                    success: true,
                    selected: Editor.Selection.getSelected(type),
                    lastSelected: Editor.Selection.getLastSelected(type) || undefined
                };
            default:
                throw new Error(`Unknown selection operation: ${args.operation}`);
        }
    }

    @utcpTool(
        'editorOperate',
        'Common editor operations for scene and prefab view, game preview controls and asset database refresh',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['save_scene_or_prefab', 'close_scene_or_prefab', 'play_preview', 'pause', 'step', 'stop', 'refresh'] }
            },
            required: ['operation']
        },
        SuccessIndicatorSchema, "POST",  ['operation', 'editor', 'scene', 'prefab', 'preview', 'asset', 'refresh']
    )
    async editorOperate(args: { operation: string }): Promise<ISuccessIndicator> {
        switch (args.operation) {
            case 'save_scene_or_prefab':
                await Editor.Message.request('scene', 'save-scene');
                return { success: true };
            case 'close_scene_or_prefab':
                await Editor.Message.request('scene', 'close-scene');
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
        'Undo or redo the last editor operation in the scene view (node/component/property changes recorded via snapshot). Use undo to roll back a failed or unwanted mutation.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['undo', 'redo'] }
            },
            required: ['operation']
        },
        SuccessIndicatorSchema, "POST", ['editor', 'undo', 'redo', 'history', 'rollback', 'revert']
    )
    async editorHistory(args: { operation: string }): Promise<ISuccessIndicator> {
        if (args.operation === 'undo') {
            await Editor.Message.request('scene', 'undo');
        } else if (args.operation === 'redo') {
            await Editor.Message.request('scene', 'redo');
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

    @utcpTool(
        'editorGetScenePreview',
        'Returns preview image of scene view. IMPORTANT: To visualize the image, you must return the result of this function DIRECTLY as the final value of your code, do NOT wrap it in an object.',
        {
            type: 'object',
            properties: {
                imageSize: { type: 'object', properties: { width: { type: 'number', default: 512 }, height: { type: 'number', default: 512 } }, nullable: true },
                jpegQuality: { type: 'integer', minimum: 40, maximum: 100, default: 80 },
                cameraPosition: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'], description: 'Camera world position'},
                targetPosition: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'], description: 'Point the camera looks at'},
                orthographic: { type: 'boolean', default: false, description: 'Whether to use orthographic projection'},
                orthographicSize: { type: 'number', default: 10, description: 'Orthographic size (only applies if orthographic is true)'}
            },
            required: ['cameraPosition', 'targetPosition']
        },
        Base64ImageSchema, "GET", ['scene', 'screenshot', 'preview', 'inspection', 'image']
    )
    async editorGetScenePreview(args: { 
        imageSize?: { width: number, height: number }, 
        jpegQuality?: number, 
        cameraPosition?: { x: number, y: number, z: number }, 
        targetPosition?: { x: number, y: number, z: number },
        orthographic?: boolean,
        orthographicSize?: number
    }): Promise<IBase64Image> {

        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: packageJSON.name,
            method: 'captureScreenshot',
            args: [args.imageSize ?? { width: 512, height: 512 }, args.jpegQuality ?? 80, args.cameraPosition , args.targetPosition, args.orthographic ?? false, args.orthographicSize ?? 10]
        });

        return { type: 'image', data: result, mimeType: 'image/jpeg' };
    }
}
