// Agent-facing tool surface cho Cocos Creator 2.4.x.
// STATIC hand-written, KHONG generated, 0 code importer. Them tool thi sua tay.
// Chi khai tool DA PASS gate — thay trong d.ts ma goi khong duoc con te hon khong co.
// Doi chieu shape that: docs/cocos-2x-api-notes.md

type Vec2Like = { x: number; y: number };
type SizeLike = { width: number; height: number };

/** Asset/node reference trong component props. __ref dung duoc voi assetQuery / assetResolve. */
type Ref2x = { __ref: string | null; __type: string | null; __name: string | null };

/** Ly do 1 nhanh bi cat. 'maxDepth' = tang maxDepth; 'nodeLimit' = tang maxNodes. */
type TruncateReason2x = 'maxDepth' | 'nodeLimit';

interface INodeBrief2x {
    name: string;
    uuid: string;
    active: boolean;
    activeInHierarchy: boolean;
    is3D: boolean;
    position: Vec2Like;
    scale: Vec2Like;
    angle: number;
    size: SizeLike;
    anchor: Vec2Like;
    components: { type: string | null; uuid: string; enabled: boolean }[];
    /** So con THAT — van dung ca khi children bi cat. */
    childrenCount: number;
    children?: INodeBrief2x[];
    truncated?: TruncateReason2x;
    /** Chi co khi truncated === 'nodeLimit': so con bi bo giua chung. */
    childrenOmitted?: number;
}

/** Node trong cay hierarchy cua editor (nguon khac INodeBrief2x: khong co transform). */
interface IHierarchyNode2x {
    name: string;
    /** compressed uuid — truyen thang lai cho nodeQuery dump/info/functions */
    id: string;
    prefabState: number;
    locked: boolean;
    isActive: boolean;
    /** true = node cua editor, khong hien o Hierarchy panel */
    hidden: boolean;
    childrenCount: number;
    children?: IHierarchyNode2x[];
    truncated?: TruncateReason2x;
    childrenOmitted?: number;
}

declare namespace cc2x4 {

    // --- Scene ---

    /**
     * GOI DAU TIEN de hieu scene. Ca cay node + transform + component list trong 1 round-trip.
     * Node cua editor da bi loc, cay khop Hierarchy panel.
     *
     * Hai gioi han doc lap: `maxDepth` chan cay SAU, `maxNodes` chan cay RONG (1 root +
     * hang nghin con thi depth khong chan duoc). Xem `budgetExhausted` de biet cay co du khong.
     */
    function sceneSnapshot(args?: { maxDepth?: number; maxNodes?: number }): {
        name: string;
        uuid: string;
        designResolution: SizeLike | null;
        maxDepth: number;
        maxNodes: number;
        /** So node da di. Bang tong node tra ve. */
        nodesVisited: number;
        /** true = cay bi cat vi het budget, KHONG phai cay day du. */
        budgetExhausted: boolean;
        children: INodeBrief2x[];
    };

    /**
     * Doc node. Khong tim thay -> THROW (dump/info/at_path), khong tra sentinel.
     * - `tree`: hierarchy tu editor (co `hidden`, khong co transform). Nhan maxDepth + maxNodes.
     * - `at_path`: 1 node theo path kieu cc.find, tra INodeBrief2x. Nhan maxDepth + maxNodes.
     * - `dump`: property day du + `__comps__`, da JSON.parse. Khoi `types` BI BO mac dinh
     *   (~90% payload, chi la schema) — ten class da bo nam o `typesOmitted`, xin lai bang
     *   `includeTypes: true`.
     * - `info`: mong
     * - `functions`: `{componentName: methodName[]}`
     * - `by_component`: mang uuid TRAN — dung `componentQuery find` neu can path
     */
    function nodeQuery(args: {
        operation: 'tree' | 'at_path' | 'dump' | 'info' | 'functions' | 'by_component';
        uuid?: string;
        path?: string;
        componentName?: string;
        maxDepth?: number;
        maxNodes?: number;
        includeTypes?: boolean;
    }): {
        result: any;
        sceneId?: string;
        /** Chi co voi operation 'tree'. */
        maxNodes?: number;
        nodesVisited?: number;
        budgetExhausted?: boolean;
    };

    /**
     * Component.
     * - `props`: property cua 1 component. Asset/node ra dang Ref2x.
     * - `find`: tra PATH dung duoc voi cc.find — manh hon `by_name` (chi uuid)
     * - `classes`: ten class hop le, loc bang `filter`
     *
     * `find` va `classes` bi cap boi `maxResults` (200). `truncated: true` = con nua;
     * `total` van la so THAT nen biet duoc con bao nhieu — loc hep hon bang `filter`.
     */
    function componentQuery(args: {
        operation: 'props' | 'classes' | 'by_name' | 'find';
        path?: string;
        componentType?: string;
        filter?: string;
        maxResults?: number;
    }): { result: any; total?: number; truncated?: boolean };

    /** Goi method cua component theo ten. Discovery: listComponentMethods. */
    function callComponentMethod(args: { uuid: string; method: string; args?: any[] }): { result: any };
    /**
     * Discovery step cho callComponentMethod (vong 2): liet ke method name moi
     * component tren node. Port tu v3 tool cung ten. Khac v3:
     *   - arg la `uuid` string (quy uoc 2.x), khong phai InstanceReference
     *   - output group theo component NAME (khong co uuid): message
     *     `scene:query-node-functions` chi tra record {componentName: methodName[]}.
     *     Khi can component uuid, lay tu `nodeQuery dump.__comps__`.
     *
     * Node khong ton tai -> throw (quy uoc vong 1.1).
     */
    function listComponentMethods(args: {
        uuid: string;
    }): { components: Array<{ name: string | null; methods: string[] }> };

    // --- Asset ---

    /**
     * Tim asset.
     * `assetTypes` la TYPE NAME (`'texture'`), KHONG phai class name (`'cc.Texture2D'`) —
     * lay danh sach qua `operation: 'types'`. Bo trong = moi type.
     * Nhan ca CSV string (e.g. `"texture,scene"`) va `string[]` (e.g. `["texture","scene"]`).
     *
     * `used_by` la chieu NGUOC cua `componentQuery props`: asset -> node dang dung no.
     * `metas` tra live meta instances (circular-safe).
     */
    function assetQuery(args: {
        operation: 'search' | 'tree' | 'info' | 'meta' | 'types' | 'sub_assets' | 'used_by' | 'metas';
        pattern?: string;
        assetTypes?: string | string[];
        url?: string;
        uuid?: string;
        limit?: number;
        maxDepth?: number;
        maxResults?: number;
        type?: string; // metas filter
    }): {
        assets?: any[];
        tree?: any[];
        info?: any;
        meta?: any;
        metaPath?: string;
        metaMtime?: number;
        types?: string[];
        classToType?: Record<string, string>;
        nodes?: { path: string; uuid: string; name: string; component: string | null; property: string }[];
        metas?: any[];
        total?: number;
        truncated?: boolean;
    };

    /** Chuyen doi url <-> uuid <-> fspath, va kiem tra ton tai + mount/relative/backup. */
    function assetResolve(args: {
        operation: 'uuid_from_url' | 'url_from_uuid' | 'fspath' | 'exists'
            | 'exists_by_path' | 'is_sub_asset' | 'contains_sub_assets'
            | 'mount_info' | 'relative_path' | 'backup_path';
        url?: string;
        uuid?: string;
        fspath?: string;
    }): {
        uuid?: string; url?: string; fspath?: string;
        exists?: boolean; isSubAsset?: boolean; containsSubAssets?: boolean;
        mountInfo?: any; relativePath?: string; backupPath?: string;
    };

    /** Doc noi dung asset text (.ts/.js/.json/.fire/.prefab/...). Binary va file >512KB bi tu choi. */
    function assetReadContent(args: { url?: string; uuid?: string; maxBytes?: number }): {
        content: string;
        fspath: string;
        bytes: number;
    };

    // --- Editor ---

    /** Doc project settings. Khong arg = tat ca; `type` = 1 file; `type`+`key` = 1 value. */
    function projectGetConfig(args?: { type?: string; key?: string }): {
        config: any;
        available: string[];
    };

    /** Version + project path. Field khong lay duoc = null, ly do o `notes` — khong bao gio throw. */
    function editorEnvInfo(): {
        editorVersion: string | null;
        engineVersion: string | null;
        nodeVersion: string;
        electronVersion: string | null;
        projectPath: string | null;
        versions: Record<string, string>;
        notes: string[];
    };

    /** Selection cua editor (asset-db-main 18 methods). Mutate SELECTION, KHONG mutate scene.
     * Ops: query/select/unselect/clear + hover/set_context/patch/filter/confirm/cancel.
     * `ids` doi voi hover = 1 id (omit = out), filter = items con can loc, patch = "srcId,destId".
     */
    function editorSelect(args: {
        operation: 'query' | 'select' | 'unselect' | 'clear' | 'hover' | 'set_context' | 'patch' | 'filter' | 'confirm' | 'cancel';
        selectionType?: 'node' | 'asset';
        ids?: string;
        unselectOthers?: boolean;
        confirm?: boolean;
        filterMode?: 'top-level' | 'deep' | 'name';
    }): {
        success: boolean;
        selected?: string[]; activate?: string | null; hovering?: string | null;
        globalActive?: { type: string; id: string } | null;
        contexts?: string[] | null; confirmed?: boolean | null;
        filtered?: string[];
        notes?: string[];
    };

    /** Mo scene khac. Truyen uuid hoac db:// url cua scene asset. */
    function sceneOpen(args: { uuid?: string; url?: string }): { success: boolean; uuid: string };
    /** Tao scene moi (scene:new-scene), fire-and-forget. */
    function sceneNew(): { success: boolean; note?: string };
    /** Apply prefab instance edits back to prefab asset (scene:set-prefab-sync), fire-and-forget. */
    function prefabSync(args: { uuid: string }): { success: boolean; note?: string };

    /** Info nhe ve scene dang mo: name/uuid/designResolution/so node. */
    function sceneInfo(): { name: string; uuid: string; designResolution: { width: number; height: number } | null; nodesVisited: number };

    /** Preview server url (null neu chua chay). */
    function previewGetUrl(): { url: string };

    /** Mo preview trong browser mac dinh. */
    function previewOpenInBrowser(): { success: boolean };

    // --- Write (probe verified: setPropertyByPath + direct_x + createNode) ---

    /** Set property tren node (path: x, y, active) hoac component (them compType). isSubProp=false for top-level (forum scene:set-property flag). */
    function nodeSetProperty(args: { uuid: string; path: string; value: any; compType?: string; isSubProp?: boolean }): { before: any; after: any; path: string };

    /** Tao node moi. */
    function nodeCreate(args: { name: string; parentUuid?: string }): { uuid: string; name: string; parent: string };

    /** Xoa node khoi scene. */
    function nodeRemove(args: { uuid: string }): { removed: string };

    /** Them/xoa component tren node. */
    function nodeComponentManage(args: { operation: 'add' | 'remove'; nodeUuid: string; compType: string }): { uuid?: string; type?: string; removed?: string };

    /** Reparent node. */
    function nodeMove(args: { uuid: string; parentUuid?: string; siblingIndex?: number }): { uuid: string; parent: string };

    /** Duplicate node (cc.instantiate). */
    function nodeDuplicate(args: { uuid: string }): { uuid: string; name: string; parent: string };

    /** Undo-aware set (via setPropertyByPath). isSubProp forwarded. */
    function nodeSetPropertyUndo(args: { uuid: string; path: string; value: any; isSubProp?: boolean }): { uuid: string; path: string; value: any };
    /** High-level create node via scene://utils/scene (undo-aware), falls back to cc.Node. */
    function sceneCreateNodeHL(args: { name: string; parentUuid?: string }): { uuid: string; name: string };
    /** High-level set property via scene://utils/scene (undo-aware), falls back to setPropertyByPath. isSubProp forwarded. */
    function sceneSetPropertyHL(args: { uuid: string; path: string; value: any; isSubProp?: boolean }): { uuid: string; path: string };
    /** Undo/redo. */
    function editorUndo(args: { operation: 'undo' | 'redo' }): { success: boolean };

    /** Asset: create folder, write content, move/rename, delete, save meta, import raw files, exchange uuid, refresh. */
    function assetCreateFolder(args: { url: string }): { url: string; fspath: string };
    function assetWriteContent(args: { url: string; content: string }): { url: string; fspath: string; bytes: number };
    function assetMove(args: { srcUrl: string; destUrl: string }): { srcUrl: string; destUrl: string };
    function assetDelete(args: { url: string }): { url: string };
    /** Save asset meta. Pass metaJson as JSON string (JSON.stringify(meta,null,2)) OR meta object. */
    function assetSaveMeta(args: { uuid: string; metaJson?: string; meta?: any }): { success: boolean; uuid: string };
    /** Import external raw files into db://. Returns results[] (uuid/url/path/type). */
    function assetImport(args: { rawfiles: string[]; destUrl: string }): { results: any[]; destUrl: string };
    /** Exchange uuids of two assets (swap identity, keep references). */
    function assetExchangeUuid(args: { urlA: string; urlB: string }): { success: boolean };
    /** Refresh asset-db at url. Returns results[] (command: create/delete/change/uuid-change). */
    function assetRefresh(args: { url: string }): { url: string; results: any[] };

    /** Editor operate: save scene, refresh assets. */
    function editorOperate(args: { operation: 'save_scene' | 'refresh_assets' }): { success: boolean };

    /** Return non-colliding db:// url (adds suffix if exists). Use before create. */
    function assetGetAvailableUrl(args: { assetPath: string }): { url: string };
    /** All registered asset types, importers, creatable presets. */
    function editorListTypes(args: { category: string }): { types: string[] };
    /** Create primitive 3D node (Cube/Sphere etc.) under parent. */
    function nodeCreatePrimitive(args: { name?: string; primitiveType: string; parentUuid?: string }): { uuid: string; name: string };
    /** Batch set properties (multi-node). Supports isSubProp per op. */
    function batchSetProperties(args: { ops: Array<{uuid:string, path:string, value:any, undo?:boolean, isSubProp?:boolean}> }): { results: Array<{uuid:string, path:string, ok:boolean}> };
    /** Write project settings. */
    function projectSaveConfig(args: { type: string; key: string; value: any }): { success: boolean };

    /** Goi handler bat ky trong scene-script (probe). */
    function sceneScript(args: { handler: string; arg1?: string; arg2?: any }): { result: any };

    /** Open http(s) URL in system browser. */
    function urlOpen(args: { url: string }): { success: boolean };
    /** Get registered program info (path, args). */
    function programGetInfo(args: { programName: string }): { path: string; commandArgument?: string };
    /** Launch registered program. */
    function programOpen(args: { programName: string; commandArguments?: Record<string, any> }): { success: boolean };
    /** Animation 2.4 (cc.Animation): clips_info/clip_dump/properties/state. */
    function animationQuery(args: { operation: string; nodeUuid?: string; path?: string; clipName?: string; includeCurves?: boolean }): { result: any };
    function animationEdit(args: { operation: string; nodeUuid?: string }): { success: boolean; note?: string };
    /** Reset node transform (undo-aware via resetPropertyByPath). */
    function nodeReset(args: { uuid: string }): { uuid: string; reset: boolean };
    function assetGetPreview(args: { uuid?: string; url?: string }): { type: string; data: string; mimeType: string; note?: string };
    function editorGetLogs(args?: { count?: number; order?: string }): { logLines: string[]; path?: string };
    function editorGetScenePreview(args?: { width?: number; height?: number }): { type: string; data: string; mimeType: string; note?: string };
    /** Clipboard copy/cut/paste/duplicate nodes. */
    function nodeClipboard(args: { operation: 'copy'|'cut'|'paste'|'duplicate'; ids?: string; targetId?: string }): { success: boolean; ids?: string[] };
}
