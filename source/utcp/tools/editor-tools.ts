import packageJSON from '../../../package.json';
import { utcpTool } from '../decorators';
import * as fs from 'fs';
import * as path from 'path';
import { Base64ImageSchema, IBase64Image, ISuccessIndicator, SuccessIndicatorSchema, InstanceReferenceSchema, IInstanceReference } from '../schemas';
import { isMessageNotExposed } from '../utils/editor-message-error';
import { ToolError } from '../tool-error';
import { askEditor } from '../editor-ask';
import { promptEditor } from '../editor-prompt';
import { EditorAskArgs, EditorAskResult, EditorPromptArgs, EditorPromptResult, EditorAskInputSchema, EditorAskOutputSchema, EditorPromptInputSchema, EditorPromptOutputSchema } from '../editor-interaction-contracts';
import { notifyEditor, progressEditor, listEditorTasks, cancelEditorTask } from '../editor-control-plane';
import { getEditorState } from '../editor-state';
import { EditorNotifyArgs, EditorProgressArgs, EditorTaskListArgs, EditorStateArgs, EditorNotifyInputSchema, EditorNotifyOutputSchema, EditorProgressInputSchema, EditorTaskSchema, EditorTaskListInputSchema, EditorTaskListOutputSchema, EditorTaskCancelInputSchema, EditorTaskCancelOutputSchema, EditorStateInputSchema, EditorStateOutputSchema } from '../editor-control-contracts';

export class EditorTools {

    @utcpTool(
        'editorAsk',
        'Ask via nonmodal Agent Inbox choice buttons by default; never opens/focuses a panel unless openPanel:true. User can open CC Bridge 3x > Agent Inbox. Await a choice or deadline (default 60s, max 5min). presentation:native explicitly opts into a modal Creator dialog; its timeout cannot dismiss the window. Default buttons OK/Cancel; cancelId defaults to the last button.',
        EditorAskInputSchema, EditorAskOutputSchema, 'POST', ['editor', 'dialog', 'question', 'confirmation']
    )
    editorAsk(args: EditorAskArgs): Promise<EditorAskResult> {
        return askEditor(args);
    }

    @utcpTool(
        'editorPrompt',
        'Request bounded text/select/confirm input in nonmodal Agent Inbox. Default does not open/focus anything: logs pending and quietly updates an existing inbox. User opens CC Bridge 3x > Agent Inbox, or openPanel:true explicitly permits activation. Await submit/cancel/deadline (60s default, 5min max). One inbox request at a time (409 otherwise). Required confirm means checked. Do not request secrets.',
        EditorPromptInputSchema, EditorPromptOutputSchema, 'POST', ['editor', 'prompt', 'form', 'input', 'confirmation']
    )
    editorPrompt(args: EditorPromptArgs): Promise<EditorPromptResult> {
        return promptEditor(args);
    }

    @utcpTool('editorNotify', 'Post a bounded info/warning/error notification quietly to Agent Inbox state and the editor log. Never opens or focuses a panel. Retained up to 5min, newest 50 notices.', EditorNotifyInputSchema, EditorNotifyOutputSchema, 'POST', ['editor', 'notification'])
    editorNotify(args: EditorNotifyArgs) { return notifyEditor(args); }

    @utcpTool('editorProgress', 'Track cooperative long work without blocking Creator. Start returns taskId; update renews its inactivity deadline (default 60s, max 5min). Finish explicitly declares completed/failed/cancelled. Progress 0-100. Expiry marks timedOut, not interruption. Poll cancelRequested and acknowledge cancellation only after work stops. Never opens/focuses panels. At most 100 retained tasks, terminal retention 5min.', EditorProgressInputSchema, EditorTaskSchema, 'POST', ['editor', 'task', 'progress'])
    editorProgress(args: EditorProgressArgs) { return progressEditor(args); }

    @utcpTool('editorTaskList', 'List retained tasks newest-first, optionally filtered by taskId/status. Default limit 50, max 100. Poll cancelRequested cooperatively; terminal status cannot be changed.', EditorTaskListInputSchema, EditorTaskListOutputSchema, 'GET', ['editor', 'task', 'state'])
    editorTaskList(args: EditorTaskListArgs = {}) { return listEditorTasks(args); }

    @utcpTool('editorTaskCancel', 'Request cooperative cancellation of a running task. Sets cancelRequested only: interrupted is always false. requested:false means already terminal. Does not interrupt code or mark cancelled; the worker must stop safely then finish with status cancelled.', EditorTaskCancelInputSchema, EditorTaskCancelOutputSchema, 'POST', ['editor', 'task', 'cancel'])
    editorTaskCancel(args: { taskId: string }) { return cancelEditorTask(args); }

    @utcpTool('editorState', 'Read bounded project path, current scene identity/readiness/dirty state, task counts and pending inbox metadata. No scene tree or prompt values. Deadline default 1s, max 5s; unavailable fields are null and listed. busy.scene means scene not ready, not a global editor lock. Read-only and never focuses panels.', EditorStateInputSchema, EditorStateOutputSchema, 'GET', ['editor', 'state', 'task', 'inbox'])
    editorState(args: EditorStateArgs = {}) { return getEditorState(args); }

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
        const info = await Editor.Message.request('engine', 'query-engine-info');
        if (!info) {
            throw new Error('Failed to query engine info');
        }
        const version = Editor.App.version;
        return {
            editor: version,
            engineVersion: version,
            enginePath: info.typescript.path || undefined,
            nativeVersion: info.native.path ? version : undefined,
            nativePath: info.native.path || undefined,
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
            required: []
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
    async editorViewport(args: { operation?: string, references?: IInstanceReference[], enabled?: boolean, size?: number, gizmoTool?: string, gizmoPivot?: string, gizmoCoordinate?: string }):
        Promise<ISuccessIndicator & { gizmoTool?: string, gizmoPivot?: string, gizmoCoordinate?: string, is2D?: boolean, gridVisible?: boolean, iconGizmo3D?: boolean, iconGizmoSize?: number }> {
        const operation = args.operation ?? 'query_viewport';
        switch (operation) {
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
            case 'query_gizmo': {
                // M1: 3 reads -> 1 round
                const [gizmoTool, gizmoPivot, gizmoCoordinate] = await Promise.all([
                    Editor.Message.request('scene', 'query-gizmo-tool-name'),
                    Editor.Message.request('scene', 'query-gizmo-pivot'),
                    Editor.Message.request('scene', 'query-gizmo-coordinate'),
                ]);
                return { success: true, gizmoTool, gizmoPivot, gizmoCoordinate };
            }
            case 'query_viewport': {
                // M1: 4 reads -> 1 round
                const [is2DRaw, gridRaw, iconGizmoRaw, iconGizmoSize] = await Promise.all([
                    Editor.Message.request('scene', 'query-is2D'),
                    Editor.Message.request('scene', 'query-is-grid-visible'),
                    Editor.Message.request('scene', 'query-is-icon-gizmo-3d'),
                    Editor.Message.request('scene', 'query-icon-gizmo-size'),
                ]);
                return { success: true, is2D: !!is2DRaw, gridVisible: !!gridRaw, iconGizmo3D: !!iconGizmoRaw, iconGizmoSize };
            }
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
        if (raw === null || raw === undefined) {
            throw new Error(`editorListTypes: query for "${args.category}" returned no payload — is a scene/project open?`);
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
        // Only helper: normalizeList. The caller must prove `raw` exists before invoking — an
        // absent payload (nullish from an untyped runtime message) must fail loud, not turn
        // into an empty list. See caller guards: layers / sorting_layers / enum_values.
        const normalizeList = (raw: any): Array<{ name?: string, value?: any }> => {
            if (!raw) {
                throw new Error('normalizeList called on nullish payload — caller should have thrown before normalizing');
            }
            const items: any[] = Array.isArray(raw) ? raw : Object.entries(raw).map(([name, value]) => ({ name, value }));
            return items.map((item: any) => typeof item === 'object' && item !== null
                ? { name: item.name ?? item.key, value: item.value }
                : { name: String(item), value: item });
        };

        switch (args.category) {
            case 'scene_mode': {
                const mode = await Editor.Message.request('scene', 'query-scene-mode');
                if (mode === null || mode === undefined) {
                    throw new Error('scene_mode: query-scene-mode returned no payload');
                }
                return { sceneMode: typeof mode === 'string' ? mode : String(mode) };
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
            case 'layers': {
                const raw = await Editor.Message.request('scene', 'query-layer-builtin');
                if (raw === null || raw === undefined) {
                    throw new Error('layers: query-layer-builtin returned no payload');
                }
                return { values: normalizeList(raw) };
            }
            case 'sorting_layers': {
                const raw = await Editor.Message.request('scene', 'query-sorting-layer-builtin');
                if (raw === null || raw === undefined) {
                    throw new Error('sorting_layers: query-sorting-layer-builtin returned no payload');
                }
                return { values: normalizeList(raw) };
            }
            case 'script_info': {
                if (!args.reference || !args.reference.id) {
                    throw new Error('editorIntrospect category "script_info" requires reference.id (script asset uuid)');
                }
                // M1: 2 reads -> 1 round
                const [name, cid] = await Promise.all([
                    Editor.Message.request('scene', 'query-script-name', args.reference.id),
                    Editor.Message.request('scene', 'query-script-cid', args.reference.id),
                ]);
                if (name == null && cid == null) {
                    throw new Error(`script_info: no script found for reference ${args.reference.id}`);
                }
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
                try {
                    return { result: await Editor.Message.request('programming', 'query-sorted-plugins' as any) };
                } catch (e: any) {
                    if (isMessageNotExposed(e, 'programming', 'query-sorted-plugins')) {
                        throw new ToolError({
                            code: 'UNSUPPORTED_EDITOR_API',
                            message: 'editorQuery "sorted_plugins" is not supported by Cocos Creator 3.7.3.',
                            recovery: 'Use shared_settings or another supported editorQuery category.',
                        });
                    }
                    throw e;
                }
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
        'editorLog',
        'Write to the Creator editor console and project log. debug uses console.log with a [debug] prefix; optional data is appended as JSON.',
        {
            type: 'object',
            properties: {
                level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
                message: { type: 'string', minLength: 1, maxLength: 4096 },
                data: { description: 'Optional JSON-serializable payload (maximum 64 KiB when serialized)' }
            },
            required: ['level', 'message'],
            additionalProperties: false
        },
        {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
                message: { type: 'string' }
            },
            required: ['success', 'level', 'message']
        }, "POST", ['editor', 'log', 'console', 'debug', 'info', 'warn', 'error']
    )
    editorLog(args: { level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown }): { success: true, level: 'debug' | 'info' | 'warn' | 'error', message: string } {
        const level = args?.level;
        if (!['debug', 'info', 'warn', 'error'].includes(level)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorLog level must be one of debug, info, warn, or error.' });
        }

        if (typeof args?.message !== 'string') {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorLog message is required and must be a string.' });
        }
        const message = args.message.trim();
        if (message.length === 0 || message.length > 4096) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorLog message must be 1-4096 characters after trimming.' });
        }

        let serialized: string | undefined;
        if (args.data !== undefined) {
            try {
                serialized = JSON.stringify(args.data);
            } catch (error) {
                throw new ToolError({
                    code: 'INVALID_ARGUMENT',
                    status: 400,
                    message: 'editorLog data must be JSON-serializable.',
                    details: { cause: error instanceof Error ? error.message : String(error) },
                });
            }
            if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 64 * 1024) {
                throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorLog data must serialize to at most 65536 bytes.' });
            }
        }

        const text = `${level === 'debug' ? '[debug] ' : ''}${message}${serialized === undefined ? '' : ` ${serialized}`}`;
        if (level === 'debug') {
            console.log(text);
        } else {
            console[level](text);
        }
        return { success: true, level, message };
    }

    @utcpTool(
        'editorGetLogs',
        'Get last N editor log entries, optionally filtered by plain-text pattern and bounded by UTF-8 response bytes',
        {
            type: 'object',
            properties: {
                count: { type: 'integer', minimum: 1, maximum: 1000, description: 'Number of log entries to retrieve', default: 10 },
                showStack: { type: 'boolean', description: 'Return full stack trace for each log entry', default: false },
                order: { type: 'string', enum: ['newest-to-oldest', 'oldest-to-newest'], description: 'Order of logs', default: 'newest-to-oldest' },
                pattern: { type: 'string', maxLength: 256, description: 'Optional plain-text substring to match against log entries' },
                maxBytes: { type: 'integer', minimum: 256, maximum: 65536, description: 'Maximum UTF-8 bytes of the serialized response', default: 65536 },
            }
        },
        { type: 'object', properties: { logLines: { type: 'array', items: { type: 'string' } }, total: { type: 'number' }, truncated: { type: 'boolean' } }, required: ['logLines', 'total', 'truncated'] }, "GET",  ['editor', 'logs', 'debug', 'info']
    )
    async editorGetLogs(args: { count?: number, showStack?: boolean, order?: 'newest-to-oldest' | 'oldest-to-newest', pattern?: string, maxBytes?: number } = {}): Promise<{ logLines: string[], total: number, truncated: boolean }> {
        const projectPath = Editor.Project.path;
        const logPath = path.join(projectPath, 'temp', 'logs', 'project.log');
        const count = args.count ?? 10;
        const showStack = args.showStack ?? false;
        const order = args.order ?? 'newest-to-oldest';
        const pattern = args.pattern;
        const maxBytes = args.maxBytes ?? 65536;

        if (pattern !== undefined && (typeof pattern !== 'string' || pattern.length > 256)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorGetLogs pattern must be plain text of at most 256 characters.' });
        }
        if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 65536) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorGetLogs maxBytes must be an integer from 256 to 65536.' });
        }
        if (!Number.isInteger(count) || count < 1 || count > 1000 || typeof showStack !== 'boolean' || !['newest-to-oldest', 'oldest-to-newest'].includes(order)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'editorGetLogs requires integer count 1-1000, boolean showStack, and a supported order.' });
        }

        const entries: string[] = [];
        let total = 0;
        let parsed = 0;
        let fileSize = 0;
        let fd: number | undefined;
        
        try {
            fd = fs.openSync(logPath, 'r');
            const stats = fs.fstatSync(fd);
            if (!stats.isFile()) throw new Error('Project log is not a regular file.');
            fileSize = stats.size;
            const bufferSize = 10 * 1024; // 10KB chunks
            const buffer = Buffer.alloc(bufferSize);
            
            let position = fileSize;
            let leftover = '';
            let byteCarry: Buffer = Buffer.alloc(0);
            let accumulatedBody = ''; // Text belonging to the current (bottom-most) entry being parsed
            
            const regex = /^(\d{1,2}-\d{1,2}-\d{4}\s\d{2}:\d{2}:\d{2}\s-\s(?:log|warn|error|info):\s)/;
            const timestampRegex = /^\d{1,2}-\d{1,2}-\d{4}\s\d{2}:\d{2}:\d{2}\s-\s/;
            
            let lastContent: string | null = null;
            let lastCount = 0;

            while (position > 0) {
                const readSize = Math.min(bufferSize, position);
                const readPos = position - readSize;

                const bytesRead = fs.readSync(fd, buffer, 0, readSize, readPos);
                if (bytesRead !== readSize) throw new Error('Project log changed while reading; retry the query.');
                position -= readSize;

                // A reverse chunk may start inside a UTF-8 code point. Carry only
                // its continuation bytes into the preceding chunk before decoding.
                const bytes = byteCarry.length ? Buffer.concat([buffer.subarray(0, readSize), byteCarry]) : buffer.subarray(0, readSize);
                let start = 0;
                if (position > 0) while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
                byteCarry = Buffer.from(bytes.subarray(0, start));
                const chunk = bytes.toString('utf-8', start);
                const combined = chunk + leftover;
                const lines = combined.split(/\r?\n/);

                if (position > 0) {
                    leftover = lines.shift() || '';
                } else {
                    leftover = '';
                }

                for (let i = lines.length - 1; i >= 0; i--) {
                    const line = lines[i];
                    if (regex.test(line)) {
                        parsed++;
                        let entry = line;
                        if (showStack && accumulatedBody.length > 0) {
                            entry += '\n' + accumulatedBody;
                        }

                        const cleaned = entry.replace(timestampRegex, '');
                        if (pattern !== undefined && !cleaned.includes(pattern)) {
                            accumulatedBody = '';
                            lastContent = null;
                            lastCount = 0;
                            continue;
                        }
                        if (cleaned === lastContent) {
                            lastCount++;
                            if (total <= count) {
                                entries[entries.length - 1] = `(${lastCount}) ${cleaned}`;
                            }
                        } else {
                            lastContent = cleaned;
                            lastCount = 1;
                            total++;
                            if (entries.length < count) {
                                entries.push(cleaned);
                            }
                        }

                        accumulatedBody = '';
                    } else if (showStack && accumulatedBody.length > 0) {
                        accumulatedBody = line + '\n' + accumulatedBody;
                    } else {
                        accumulatedBody = line;
                    }
                }
            }
            
        } catch (error) {
            throw new ToolError({ code: 'LOG_UNAVAILABLE', status: 503, message: 'Cannot read the project log.', details: { cause: error instanceof Error ? error.message : String(error) }, recovery: 'Check temp/logs/project.log availability and permissions, then retry.' });
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
        // Parsing health is independent of whether the requested filter matches.
        if (fileSize > 0 && parsed === 0) {
            throw new ToolError({ code: 'LOG_PARSE_DRIFT', status: 422, message: 'Nonempty project log contains no recognized timestamp-prefixed entries.', recovery: 'Inspect the project log format before retrying.' });
        }
        // We pushed entries in reverse order (newest first).
        const ordered = order === 'oldest-to-newest' ? entries.reverse() : entries;
        let truncated = total > count;
        while (Buffer.byteLength(JSON.stringify({ logLines: ordered, total, truncated }), 'utf8') > maxBytes && ordered.length > 0) {
            ordered.pop();
            truncated = true;
        }
        return { logLines: ordered, total, truncated };
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
