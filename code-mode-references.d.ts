// Instance reference should newer be kept in memory
type InstanceReference = { id: string; type: string };
interface IAssetTree {
    filesystemPath?: string;
    reference: InstanceReference;
    name: string;
    children: IAssetTree[];
}
interface IHierarchyTree {
    path?: string;
    reference: InstanceReference;
    name: string;
    active: boolean;
    components: InstanceReference[];
    children: IHierarchyTree[];
}

interface IExposedAttributes { type?: string, visible?: boolean, multiline?: boolean, min?: number, max?: number }
// Decorator for properties
declare function property(options: IExposedAttributes): any

// Cocos types
type Vec2 = Vector2;
type Vec3 = Vector3;
type Vec4 = Vector4;
type Quat = Quaternion;
type Mat3 = {
    m00: number; m01: number; m02: number;
    m03: number; m04: number; m05: number;
    m06: number; m07: number; m08: number;
}
type Mat4 = {
    m00: number; m01: number; m02: number; m03: number;
    m04: number; m05: number; m06: number; m07: number;
    m08: number; m09: number; m10: number; m11: number;
    tm12: number; m13: number; m14: number; m15: number;
}
type Color = { r: number; g: number; b: number; a: number; }
type Rect = { x: number; y: number; width: number; height: number; }
type Size = { width: number, height: number };
// The single difference between Unity and Cocos gradient is color represented as flat 3 numbers array (r, g, b)
type Gradient = { colorKeys: Array<{ color: Array<number>, time: number }>, alphaKeys: Array<{ alpha: number, time: number }>, mode: number }

/**
 * Cocos Editor Tools
 */
declare namespace CocosEditor {
    /** Generates TypeScript definition for specific settings. */
    function inspectorGetSettingsDefinition(args: {
        settingsType: "CommonTypes" | "CurrentSceneGlobals" | "ProjectSettings"
    }): { definition: string };

    /** Generates TypeScript definition based on properties of instance. */
    function inspectorGetInstanceDefinition(args: { reference: InstanceReference }): { definition: string };

    /** Gets plain object of properties for the specific settings. */
    function inspectorGetSettingsProperties(args: {
        settingsType: "CurrentSceneGlobals" | "ProjectSettings"
    }): { dump: any };

    /** Gets plain object of properties for any instance. */
    function inspectorGetInstanceProperties(args: { reference: InstanceReference }): { dump: any };

    /** Sets a property on the specific settings. */
    function inspectorSetSettingsProperties(args: {
        settingsType: "CurrentSceneGlobals" | "ProjectSettings",
        propertyPaths: string[],
        values: any[]
    }): { success: boolean, error?: string };

    /** Sets a property on instance of Node, Component or Asset. */
    function inspectorSetInstanceProperties(args: {
        reference: InstanceReference,
        propertyPaths: string[],
        values: any[]
    }): { success: boolean, error?: string };

    /** Get the asset and subAsset hierarchy tree. */
    function assetGetTree(args: {
        reference?: InstanceReference,
        assetPath?: string
    }): IAssetTree;

    /** Get asset reference by given local path and name. */
    function assetGetAtPath(args: { assetPath: string }): { reference: InstanceReference };

    /** Resolve filesystem path and db:// url for an asset by its uuid. Lighter than query-asset-info when you only need locations. */
    function assetResolvePath(args: { reference: InstanceReference }): { filesystemPath: string, url?: string };

    /** Search the asset database with filters (glob pattern, ccType, importer, extname, isBundle). At least one filter required. */
    function assetQuery(args: {
        pattern?: string,
        ccType?: string,
        importer?: string,
        extname?: string,
        isBundle?: boolean,
        limit?: number
    }): { assets: { uuid: string, name: string, url: string, type: string, importer?: string, isDirectory: boolean }[], total: number, truncated: boolean };

    /** Overwrite the content of an existing text-based asset (TypeScript, JSON, effect, txt...). Identify by db:// path or uuid. Binary not supported. */
    function assetSaveContent(args: { assetPath?: string, reference?: InstanceReference, content: string }): { reference: InstanceReference, filesystemPath?: string };

    /** Returns an available (non-colliding) db:// url for a desired path - appends suffix if an asset exists there. */
    function assetGetAvailableUrl(args: { assetPath: string }): { url: string };

    /** Create empty asset or folder of given type. */
    function assetCreate(args: {
        assetPath: string,
        preset: "folder" | "material" | "effect" | "scene" | "prefab" | "typescript" | "animation-clip" | "render-texture" | "physics-material" | "animation-graph" | "animation-graph-variant" | "animation-mask" | "auto-atlas" | "effect-header" | "label-atlas" | "terrain",
        options?: { overwrite?: boolean, rename?: boolean }
    }): { reference: InstanceReference };

    /** Import an external file as an asset into the project. */
    function assetImport(args: {
        sourceFilesystemPath: string,
        targetAssetPath: string,
        imageType?: "raw" | "texture" | "normal-map" | "sprite-frame" | "texture-cube",
        options?: { overwrite?: boolean, rename?: boolean }
    }): { reference: InstanceReference };

    /** Perform operations on assets (move, copy, delete, open). */
    function assetOperate(args: {
        operation: "move" | "copy" | "delete" | "open" | "refresh" | "reimport",
        reference: InstanceReference,
        targetAssetPath?: string,
        options?: { overwrite?: boolean, rename?: boolean }
    }): { reference: InstanceReference };

    /** Returns preview image of the asset. */
    function assetGetPreview(args: {
        reference: InstanceReference,
        imageSize?: number,
        jpegQuality?: number,
        transparentColor?: Color
    }): { type: string, data: string, mimeType: string };

    /** Get list of globally available component types. */
    function nodeGetAvailableComponentTypes(args: {
        includeInternal: boolean,
        filter?: string
    }): { componentTypes: string[] };

    /** Get components of specific type on a node. */
    function nodeComponentsGet(args: {
        reference: InstanceReference,
        componentType?: string
    }): { references: InstanceReference[] };

    /** Remove referenced component from node it is attached to. */
    function nodeComponentRemove(args: { reference: InstanceReference }): { success: boolean, error?: string };

    /** Add a component to a referenced node. */
    function nodeComponentAdd(args: {
        reference: InstanceReference,
        componentType: string
    }): { reference: InstanceReference };

    /** Open a scene by its uuid. Complements editorOperate save/close (no open). Resolve uuid via assetGetAtPath if you only have the path. */
    function sceneOpen(args: { reference: InstanceReference }): { success: boolean, error?: string };

    /** Get info about the current scene: bounds (canvas/scene size), unsaved changes (dirty), and which scene asset is open. */
    function sceneGetInfo(): { bounds: { x: number, y: number, width: number, height: number }, dirty: boolean, currentScene?: { uuid?: string, url?: string, name?: string } };

    /** Find all nodes in the current scene that reference the given asset uuid (reverse-reference / impact analysis). */
    function findNodesByAsset(args: { reference: InstanceReference }): { references: InstanceReference[] };

    /** Find all nodes whose asset references are missing/broken. QA/health check for scene integrity. */
    function findNodesWithMissingAssets(): { references: InstanceReference[] };

    /** Reset nodes or one component back to default property values. operation "node" (uuids) or "component" (single uuid). */
    function nodeReset(args: { operation: "node" | "component", references: InstanceReference[] }): { success: boolean, error?: string };

    /** Execute a method on a component by its uuid. Arguments and return value must be JSON-serializable. Get the component uuid via nodeComponentsGet. */
    function callComponentMethod(args: { reference: InstanceReference, methodName: string, methodArgs?: any[] }): { result: any };

    /** List classes known to the editor, optionally filtered by base class (e.g. "cc.Component"). Helps resolve valid class names before nodeComponentAdd. */
    function listComponentClasses(args: { extends?: string, excludeSelf?: boolean, filter?: string }): { classes: string[] };

    /** Copy/cut/paste nodes. For paste pass targetReference plus the copied references. Returns references of pasted nodes for paste. */
    function nodeClipboard(args: {
        operation: "copy" | "cut" | "paste",
        references: InstanceReference[],
        targetReference?: InstanceReference,
        keepWorldTransform?: boolean,
        pasteAsChild?: boolean
    }): { success: boolean, references?: InstanceReference[] };

    /** Get the hierarchy tree of specific node or scene root. */
    function nodeGetTree(args: { reference?: InstanceReference }): IHierarchyTree;

    /** Get nodes at specific path in the scene hierarchy. */
    function nodeGetAtPath(args: { hierarchyPath: string }): { references?: InstanceReference[] };

    /** Create a new node with predefined primitive geometry. */
    function nodeCreatePrimitive(args: {
        name?: string,
        primitiveType?: "Capsule" | "Cone" | "Cube" | "Cylinder" | "Plane" | "Quad" | "Sphere" | "Torus",
        parentReference?: InstanceReference
    }): { reference: InstanceReference };

    /** Create a new node in the scene. */
    function nodeCreate(args: {
        name: string,
        parentReference?: InstanceReference,
        assetReference?: InstanceReference
    }): { reference: InstanceReference };

    /** Perform operation on referenced node, including prefab operations. */
    function nodeOperate(args: {
        operation: "move" | "copy" | "delete" | "create_prefab" | "revert_prefab" | "apply_prefab" | "unwrap_prefab" | "unwrap_prefab_completely" | "open_prefab",
        reference: InstanceReference,
        newParentReference?: InstanceReference,
        newPrefabPath?: string,
        siblingIndex?: number
    }): {
        success?: boolean,
        createdPrefabAssetReference?: InstanceReference,
        updatedNodeReference?: InstanceReference,
        copiedNodeReference?: InstanceReference
    };

    /** Get info about the current editor environment: editor version, engine version and paths, native engine info, current project path. */
    function editorEnvInfo(): { editor: string, engineVersion: string, enginePath?: string, nativeVersion?: string, nativePath?: string, projectPath: string };

    /** Undo or redo the last editor operation in the scene view. Use undo to roll back a failed or unwanted mutation. */
    function editorHistory(args: { operation: "undo" | "redo" }): { success: boolean, error?: string };

    /** Control the editor scene viewport: focus camera on nodes, 2D/3D mode, grid visibility, gizmo tool, align view/node (align ops act on the current selection). Frame nodes before editorGetScenePreview. */
    function editorViewport(args: {
        operation: "focus" | "set_2d_mode" | "set_grid_visible" | "set_gizmo_tool" | "align_view_to_selected_node" | "align_selected_node_to_view",
        references?: InstanceReference[],
        enabled?: boolean,
        gizmoTool?: "move" | "rotate" | "scale" | "rect"
    }): { success: boolean, error?: string };

    /** Select, deselect, clear or query the editor selection for nodes or assets. Enables align operations in editorViewport. */
    function editorSelect(args: {
        operation: "select" | "unselect" | "clear" | "query",
        selectionType?: "node" | "asset",
        references?: InstanceReference[]
    }): { success: boolean, selected?: string[], lastSelected?: string };

    /** Get info about a program registered with the editor (path and default command arguments). */
    function programGetInfo(args: { programName: string }): { path: string, commandArgument?: string };

    /** Launch a program registered with the editor (only registered programs, not arbitrary executables). */
    function programOpen(args: { programName: string, commandArguments?: Record<string, any> }): { success: boolean, error?: string };

    /** Open a URL in the system default browser. */
    function urlOpen(args: { url: string }): { success: boolean, error?: string };

    /** Read project settings: no args = all, type = one category (general, physics, sorting-layer...), type+key = one value. */
    function projectGetConfig(args: { type?: string, key?: string }): { config: any };

    /** Write project settings. Path = category name or dotted path (e.g. "general", "layer.3"). Caution: affects the whole project. */
    function projectSetConfig(args: { path: string, value: any }): { success: boolean };

    /** Get the URL of the editor game preview server. */
    function previewGetUrl(): { url: string };

    /** Open the current scene/game preview in the system default browser. */
    function previewOpenInBrowser(): { success: boolean, error?: string };

    /** Common editor operations for scene and prefab view. */
    function editorOperate(args: {
        operation: "save_scene_or_prefab" | "close_scene_or_prefab" | "play_preview" | "pause" | "step" | "stop" | "refresh"
    }): { success: boolean, error?: string };

    /** Get last N editor log entries. */
    function editorGetLogs(args: {
        count: number,
        showStack?: boolean,
        order: "newest-to-oldest" | "oldest-to-newest"
    }): { logLines: string[] };

    /** Open the editor build panel ('default' or 'build-bundle'). */
    function buildPanelOpen(args: { panel?: "default" | "build-bundle" }): { success: boolean, error?: string };

    /** Get build pipeline status: worker ready, queue free, and summary of all build tasks. */
    function buildGetTasksInfo(): { workerReady: boolean, free: boolean, tasks: { id: string, progress: number, state: string, message?: string, time?: string, stage?: string, dirty?: boolean, name?: string, platform?: string, buildPath?: string }[] };

    /** Get one build task by id: summary plus its FULL options object (clone + modify to trigger new builds). */
    function buildGetTask(args: { taskId: string }): { task: { id: string, progress: number, state: string, message?: string, name?: string, platform?: string }, options?: any };

    /** Enqueue a build task. Copy options from buildGetTask and modify instead of crafting from scratch. Poll status with buildGetTasksInfo. */
    function buildTrigger(args: { options: any }): { success: boolean, taskId?: string };

    /** Returns preview image of scene view. */
    function editorGetScenePreview(args: {
        imageSize?: { width?: number, height?: number },
        jpegQuality?: number,
        cameraPosition: Vector3,
        targetPosition: Vector3
    }): { type: string, data: string, mimeType: string };
}