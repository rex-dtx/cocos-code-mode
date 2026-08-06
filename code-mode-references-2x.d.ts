// Agent-facing tool surface cho Cocos Creator 2.4.x — READ-ONLY (vong 1).
// STATIC hand-written, KHONG generated, 0 code importer. Them tool thi sua tay.
// Chi khai tool DA PASS gate — thay trong d.ts ma goi khong duoc con te hon khong co.
// Doi chieu shape that: docs/cocos-2x-api-notes.md

type Vec2Like = { x: number; y: number };
type SizeLike = { width: number; height: number };

/** Asset/node reference trong component props. __ref dung duoc voi assetQuery / assetResolve. */
type Ref2x = { __ref: string | null; __type: string | null; __name: string | null };

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
    childrenCount: number;
    children?: INodeBrief2x[];
    /** true khi bi cat boi maxDepth — tang maxDepth de xem tiep */
    truncated?: boolean;
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
    truncated?: boolean;
}

declare namespace CocosEditor {

    // --- Scene ---

    /**
     * GOI DAU TIEN de hieu scene. Ca cay node + transform + component list trong 1 round-trip.
     * Node cua editor da bi loc, cay khop Hierarchy panel.
     */
    function sceneSnapshot(args?: { maxDepth?: number }): {
        name: string;
        uuid: string;
        designResolution: SizeLike | null;
        maxDepth: number;
        children: INodeBrief2x[];
    };

    /**
     * Doc node.
     * - `tree`: hierarchy tu editor (co `hidden`, khong co transform)
     * - `at_path`: 1 node theo path kieu cc.find, tra INodeBrief2x
     * - `dump`: property day du + `__comps__`, da JSON.parse. NANG (~19KB/node) — dung goi hang loat.
     *   uuid sai KHONG loi: tra `{types:{}, value:null}`, phai tu check `value === null`.
     * - `info`: mong, co co `missed`
     * - `functions`: `{componentName: methodName[]}`
     * - `by_component`: mang uuid TRAN — dung `componentQuery find` neu can path
     */
    function nodeQuery(args: {
        operation: 'tree' | 'at_path' | 'dump' | 'info' | 'functions' | 'by_component';
        uuid?: string;
        path?: string;
        componentName?: string;
        maxDepth?: number;
    }): { result: any; sceneId?: string };

    /**
     * Component.
     * - `props`: property cua 1 component. Asset/node ra dang Ref2x.
     * - `find`: tra PATH dung duoc voi cc.find — manh hon `by_name` (chi uuid)
     * - `classes`: ten class hop le, loc bang `filter`
     */
    function componentQuery(args: {
        operation: 'props' | 'classes' | 'by_name' | 'find';
        path?: string;
        componentType?: string;
        filter?: string;
    }): { result: any; total?: number };

    // --- Asset ---

    /**
     * Tim asset.
     * `assetTypes` la TYPE NAME (`'texture'`), KHONG phai class name (`'cc.Texture2D'`) —
     * lay danh sach qua `operation: 'types'`. Bo trong = moi type.
     */
    function assetQuery(args: {
        operation: 'search' | 'tree' | 'info' | 'meta' | 'types' | 'sub_assets';
        pattern?: string;
        assetTypes?: string;
        url?: string;
        uuid?: string;
        limit?: number;
        maxDepth?: number;
    }): {
        assets?: any[];
        tree?: any[];
        info?: any;
        meta?: any;
        metaPath?: string;
        metaMtime?: number;
        types?: string[];
        classToType?: Record<string, string>;
        total?: number;
        truncated?: boolean;
    };

    /** Chuyen doi url <-> uuid <-> fspath, va kiem tra ton tai. */
    function assetResolve(args: {
        operation: 'uuid_from_url' | 'url_from_uuid' | 'fspath' | 'exists';
        url?: string;
        uuid?: string;
    }): { uuid?: string; url?: string; fspath?: string; exists?: boolean };

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

    /** Selection cua editor. Mutate SELECTION, KHONG mutate scene. */
    function editorSelect(args: {
        operation: 'query' | 'select' | 'unselect' | 'clear';
        selectionType?: 'node' | 'asset';
        /** comma-separated uuid */
        ids?: string;
        unselectOthers?: boolean;
    }): { success: boolean; selected?: string[]; activate?: string | null; hovering?: string | null };
}
