import { utcpTool } from '../decorators';
import { InstanceReferenceSchema, IInstanceReference, ISuccessIndicator, SuccessIndicatorSchema } from '../schemas';
import { ToolsUtils } from '../utils/tools-utils';

// Consolidated tools — preferred entry points that replace groups of legacy tools.
// Legacy tools remain registered with @deprecated tag for one major version (A1 shim).
// Next major: remove legacy @utcpTool registrations to reach 45 tools.

export class ConsolidatedTools {

    // ── inspectorGet: instance + settings properties ──────────────────
    @utcpTool(
        'inspectorGet',
        'Get properties for instance or settings. Use fields[] for specific keys.',
        {
            type: 'object',
            properties: {
                target: { type: 'string', enum: ['instance', 'CurrentSceneGlobals', 'ProjectSettings'], description: 'instance = node/component/asset by reference; settings = scene/project globals' },
                reference: InstanceReferenceSchema,
                fields: { type: 'array', items: { type: 'string' }, description: 'Only return these top-level keys. Omit for full dump.' }
            },
            required: ['target']
        },
        { type: 'object', properties: { dump: { type: 'object' } }, required: ['dump'] }, 'GET',
        ['inspect', 'properties', 'consolidated', 'inspector']
    )
    async inspectorGet(args: { target: string, reference?: IInstanceReference, fields?: string[] }): Promise<{ dump: any }> {
        const id = args.target === 'instance'
            ? (args.reference?.id ?? (() => { throw new Error('inspectorGet target=instance requires reference.id'); })())
            : args.target;
        const info = await ToolsUtils.inspectInstance(id);
        if (!info) throw new Error(`Target ${id} not found or not supported.`);
        const { props, type } = info;
        if (!props) throw new Error(`Could not retrieve properties for ${type} (${id}).`);
        let filteredProps: any = props;
        if (args.fields && args.fields.length > 0) {
            filteredProps = {};
            for (const key of args.fields) if (key in props) filteredProps[key] = (props as any)[key];
        }
        const parsed = ToolsUtils.unwrapProperties(filteredProps);
        return { dump: parsed };
    }

    // ── inspectorSet: instance + settings ─────────────────────────────
    @utcpTool(
        'inspectorSet',
        'Set properties on instance or settings. Paths and values arrays must align.',
        {
            type: 'object',
            properties: {
                target: { type: 'string', enum: ['instance', 'CurrentSceneGlobals', 'ProjectSettings'] },
                reference: InstanceReferenceSchema,
                propertyPaths: { type: 'array', items: { type: 'string' }, description: 'Property paths, e.g. ["position.x"]' },
                values: { type: 'array', items: {} },
                // compat singular form
                propertyPath: { type: 'string' },
                value: {}
            },
            required: ['target']
        },
        SuccessIndicatorSchema, 'POST',
        ['property', 'set', 'consolidated', 'inspector']
    )
    async inspectorSet(args: { target: string, reference?: IInstanceReference, propertyPaths?: string[], values?: any[], propertyPath?: string, value?: any }): Promise<ISuccessIndicator> {
        // delegate to existing SetPropertyTool logic via ToolsUtils path
        const { SetPropertyTool } = await import('./set-properties-tool');
        const tool = new (SetPropertyTool as any)();
        let propertyPaths = args.propertyPaths ?? (args.propertyPath !== undefined ? [args.propertyPath] : undefined);
        let values = args.values ?? (args.value !== undefined ? [args.value] : undefined);
        if (!propertyPaths || !values) throw new Error('inspectorSet requires propertyPaths+values (or propertyPath+value)');
        if (args.target === 'instance') {
            if (!args.reference?.id) throw new Error('inspectorSet target=instance requires reference.id');
            return tool.setInstanceProperties({ reference: args.reference, propertyPaths, values });
        }
        // settings target
        return tool.setCurrentSceneProperties({ settingsType: args.target, propertyPaths, values } as any);
    }

    // ── inspectorGetDefinition: instance + settings ───────────────────
    @utcpTool(
        'inspectorGetDefinition',
        'Generate TS definition for instance or settings. Use section for single class.',
        {
            type: 'object',
            properties: {
                target: { type: 'string', enum: ['instance', 'CommonTypes', 'CurrentSceneGlobals', 'ProjectSettings'] },
                reference: InstanceReferenceSchema,
                section: { type: 'string', description: 'Class/enum name to return only that section.' }
            },
            required: ['target']
        },
        { type: 'object', properties: { definition: { type: 'string' }, sections: { type: 'array', items: { type: 'string' } }, totalSections: { type: 'number' } }, required: ['definition'] }, 'GET',
        ['code', 'typescript', 'definition', 'consolidated']
    )
    async inspectorGetDefinition(args: { target: string, reference?: IInstanceReference, section?: string }): Promise<{ definition: string, sections: string[], totalSections: number }> {
        const { GetClassInfoTool } = await import('./typescript-defenition');
        const tool = new (GetClassInfoTool as any)();
        if (args.target === 'instance') {
            if (!args.reference?.id) throw new Error('inspectorGetDefinition target=instance requires reference.id');
            return tool.inspectorGetInstanceDefinition({ reference: args.reference, section: args.section } as any);
        }
        return tool.inspectorGetSettingsDefinition({ settingsType: args.target as any, section: args.section } as any);
    }

    // ── nodeComponentManage: add/remove ───────────────────────────────
    @utcpTool(
        'nodeComponentManage',
        'Add or remove component on node.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['add', 'remove'] },
                reference: InstanceReferenceSchema,
                componentType: { type: 'string', description: 'For add: component class name' }
            },
            required: ['operation', 'reference']
        },
        { type: 'object', properties: { reference: InstanceReferenceSchema, success: { type: 'boolean' } } }, 'POST',
        ['scene', 'node', 'component', 'consolidated']
    )
    async nodeComponentManage(args: { operation: string, reference: IInstanceReference, componentType?: string }): Promise<any> {
        const { ComponentTools } = await import('./component-tools');
        const tool = new (ComponentTools as any)();
        if (args.operation === 'add') {
            if (!args.componentType) throw new Error('nodeComponentManage add requires componentType');
            return tool.nodeComponentAdd({ reference: args.reference, componentType: args.componentType });
        }
        if (args.operation === 'remove') return tool.nodeComponentRemove({ reference: args.reference });
        throw new Error(`Unknown nodeComponentManage operation: ${args.operation}`);
    }

    // ── editorQuery: introspect + listTypes ───────────────────────────
    @utcpTool(
        'editorQuery',
        'Query editor state or vocabularies.',
        {
            type: 'object',
            properties: {
                category: {
                    type: 'string',
                    enum: ['scene_mode', 'ready', 'enum_values', 'layers', 'sorting_layers', 'script_info', 'has_script', 'creatable_assets', 'asset_types', 'importers']
                },
                enumPath: { type: 'string' },
                className: { type: 'string' },
                reference: InstanceReferenceSchema
            },
            required: ['category']
        },
        { type: 'object', properties: { sceneMode: { type: 'string' }, ready: { type: 'boolean' }, values: { type: 'array', items: { type: 'object' } }, types: { type: 'array', items: { type: 'string' } }, scriptName: { type: 'string' }, scriptCid: { type: 'string' }, hasScript: { type: 'boolean' } } }, 'GET',
        ['editor', 'introspect', 'query', 'consolidated']
    )
    async editorQuery(args: { category: string, enumPath?: string, className?: string, reference?: IInstanceReference }): Promise<any> {
        const { EditorTools } = await import('./editor-tools');
        const tool = new (EditorTools as any)();
        const vocabCategories = new Set(['creatable_assets', 'asset_types', 'importers']);
        if (vocabCategories.has(args.category)) return tool.editorListTypes({ category: args.category });
        return tool.editorIntrospect({ category: args.category, enumPath: args.enumPath, className: args.className, reference: args.reference } as any);
    }

    // ── sceneManage: open/save/close/soft_reload ─────────────────────
    @utcpTool(
        'sceneManage',
        'Manage scene lifecycle: open/save/close/soft_reload/save_as.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['open', 'save', 'save_as', 'close', 'soft_reload'] },
                reference: InstanceReferenceSchema
            },
            required: ['operation']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' }, reference: InstanceReferenceSchema } }, 'POST',
        ['scene', 'lifecycle', 'consolidated']
    )
    async sceneManage(args: { operation: string, reference?: IInstanceReference }): Promise<any> {
        const { SceneTools } = await import('./scene-tools');
        const { EditorTools } = await import('./editor-tools');
        const sceneTool = new (SceneTools as any)();
        const editorTool = new (EditorTools as any)();
        switch (args.operation) {
            case 'open':
                if (!args.reference?.id) throw new Error('sceneManage open requires reference.id');
                return sceneTool.sceneOpen({ reference: args.reference });
            case 'save': return editorTool.editorOperate({ operation: 'save_scene_or_prefab' });
            case 'save_as': return editorTool.editorOperate({ operation: 'save_as' });
            case 'close': return editorTool.editorOperate({ operation: 'close_scene_or_prefab' });
            case 'soft_reload': return editorTool.editorOperate({ operation: 'soft_reload' });
            default: throw new Error(`Unknown sceneManage operation: ${args.operation}`);
        }
    }

    // ── buildManage: panel/tasks/trigger/control ─────────────────────
    @utcpTool(
        'buildManage',
        'Manage builds: open panel, query tasks, trigger, control.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['panel_open', 'tasks_info', 'get_task', 'trigger', 'control'] },
                panel: { type: 'string', enum: ['default', 'build-bundle'] },
                taskId: { type: 'string' },
                options: { type: 'object', description: 'Build options for trigger' },
                control: { type: 'string', enum: ['break', 'remove', 'recompile'] }
            },
            required: ['operation']
        },
        { type: 'object', properties: { success: { type: 'boolean' }, workerReady: { type: 'boolean' }, free: { type: 'boolean' }, tasks: { type: 'array', items: { type: 'object' } }, task: { type: 'object' }, options: { type: 'object' }, taskId: { type: 'string' } } }, 'POST',
        ['build', 'consolidated']
    )
    async buildManage(args: { operation: string, panel?: string, taskId?: string, options?: any, control?: string }): Promise<any> {
        const { BuildTools } = await import('./build-tools');
        const tool = new (BuildTools as any)();
        switch (args.operation) {
            case 'panel_open': return tool.buildPanelOpen({ panel: args.panel });
            case 'tasks_info': return tool.buildGetTasksInfo();
            case 'get_task': return tool.buildGetTask({ taskId: args.taskId as string });
            case 'trigger': return tool.buildTrigger({ options: args.options });
            case 'control': return tool.buildTaskControl({ operation: args.control as string, taskId: args.taskId as string });
            default: throw new Error(`Unknown buildManage operation: ${args.operation}`);
        }
    }
}
