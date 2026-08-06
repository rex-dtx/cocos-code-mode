// Cocos Creator 2.4.x editor API — viet tay tu docs corpus cc_docs, prefix v2.4/extension/.
// KHONG generated. Moi namespace co comment ghi doc nguon.
// Quy tac: khong khai bao thu gi khong co trong docs. Cho nao chua verify -> ghi comment.

interface IAssetInfo2x {
    uuid: string;
    path: string;
    url: string;
    type: string;
    isSubAsset: boolean;
}

interface IMetaInfo2x {
    assetPath: string;
    metaPath: string;
    assetMtime: number;
    metaMtime: number;
    json: string;
}

// ⚠️ VERIFY runtime 2.4.15: deepQuery tra FLAT list co parentUuid, KHONG nested children.
// Docs asset-db-main.md khai `result.children` -> SAI. Key that:
// uuid / parentUuid / name / extname / type / isSubAsset / hidden / readonly
interface IDeepQueryResult2x {
    uuid: string;
    parentUuid: string;
    name: string;
    extname: string;
    type: string;
    isSubAsset: boolean;
    hidden: boolean;
    readonly: boolean;
}

// VERIFY runtime 2.4.15: docs khai 5 field, runtime tra them readonly/hidden/destPath.
interface IQueryAssetResult2x {
    url: string;
    path: string;
    uuid: string;
    type: string;
    isSubAsset: boolean;
    readonly: boolean;
    hidden: boolean;
    destPath: string | null;
}

interface IMountInfo2x {
    path: string;
    name: string;
    type: string;
}

// Callback-last idiom cua editor-framework 2.x: err truoc, result sau.
type Cb2x<T> = (err: Error | null, result: T) => void;

declare namespace Editor {
    // api/editor-framework/main/ipc.md
    // callback + timeout la 2 arg cuoi (optional). Timeout default 5000ms, -1 = khong timeout.
    namespace Ipc {
        function sendToMain(message: string, ...args: any[]): void;
        function sendToPanel(panelID: string, message: string, ...args: any[]): void;
        function sendToMainWin(message: string, ...args: any[]): void;
        function sendToWins(message: string, ...args: any[]): void;
        function sendToAll(message: string, ...args: any[]): void;
        function cancelRequest(sessionID: string): void;
        function option(opts: { excludeSelf?: boolean }): any;
        // LUU Y: sendToPackage CHI co o renderer process (renderer/ipc.md).
        // Main process khong co -> khong khai bao o day.
    }

    // scene-script.md — callSceneScript nhan cung param nhu cac IPC sender khac
    // (args tuy y, callback + timeout o cuoi).
    namespace Scene {
        function callSceneScript(pkgName: string, message: string, ...args: any[]): void;
    }

    // api/asset-db/asset-db-main.md — MAIN process instance.
    // Nhieu method SYNC (tra thang, khong callback). Cac queryInfoByUuid/queryMetaInfoByUuid
    // la RENDERER-only; main process dung assetInfoByUuid/loadMetaByUuid (sync) thay the.
    namespace assetdb {
        // --- sync ---
        function urlToUuid(url: string): string | null;
        function uuidToUrl(uuid: string): string | null;
        function fspathToUuid(fspath: string): string | null;
        function uuidToFspath(uuid: string): string | null;
        function urlToFspath(url: string): string | null;
        function fspathToUrl(fspath: string): string | null;
        function exists(url: string): boolean;
        function existsByUuid(uuid: string): boolean;
        function existsByPath(fspath: string): boolean;
        function isSubAsset(url: string): boolean;
        function isSubAssetByUuid(uuid: string): boolean;
        function isSubAssetByPath(fspath: string): boolean;
        function containsSubAssets(url: string): boolean;
        function containsSubAssetsByUuid(uuid: string): boolean;
        function containsSubAssetsByPath(fspath: string): boolean;
        function assetInfo(url: string): IAssetInfo2x | null;
        function assetInfoByUuid(uuid: string): IAssetInfo2x | null;
        function assetInfoByPath(fspath: string): IAssetInfo2x | null;
        function subAssetInfos(url: string): IAssetInfo2x[];
        function subAssetInfosByUuid(uuid: string): IAssetInfo2x[];
        function subAssetInfosByPath(fspath: string): IAssetInfo2x[];
        function loadMeta(url: string): any;
        function loadMetaByUuid(uuid: string): any;
        function loadMetaByPath(fspath: string): any;
        function isMount(url: string): boolean;
        function isMountByUuid(uuid: string): boolean;
        function isMountByPath(fspath: string): boolean;
        function mountInfo(url: string): IMountInfo2x | null;
        function mountInfoByUuid(uuid: string): IMountInfo2x | null;
        function mountInfoByPath(fspath: string): IMountInfo2x | null;
        function getRelativePath(fspath: string): string;
        function getAssetBackupPath(filePath: string): string;

        // --- async (callback-last) ---
        function queryAssets(pattern: string, assetTypes: string | string[], cb: Cb2x<IQueryAssetResult2x[]>): void;
        function queryMetas(pattern: string, type: string, cb: Cb2x<any[]>): void;
        function deepQuery(cb: Cb2x<IDeepQueryResult2x[]>): void;
        function refresh(url: string, cb?: Cb2x<any[]>): void;

        // --- WRITE: khai bao san cho vong 2, KHONG dung o vong 1 (read-only) ---
        function create(url: string, data: string, cb?: Cb2x<any[]>): void;
        function saveExists(url: string, data: string, cb?: Cb2x<any>): void;
        function saveMeta(uuid: string, jsonString: string, cb?: Cb2x<any>): void;
        function move(srcUrl: string, destUrl: string, cb?: Cb2x<any[]>): void;
        function exchangeUuid(urlA: string, urlB: string, cb?: Cb2x<any>): void;
        function clearImports(url: string, cb?: Cb2x<any[]>): void;
        // 'delete' va 'import' la reserved word trong TS namespace -> khong khai duoc.
        // Call site vong 2 dung: (Editor.assetdb as any)['delete'](urls, cb)
        //                       (Editor.assetdb as any)['import'](rawfiles, url, cb)
    }

    // api/editor-framework/share/selection.md
    namespace Selection {
        function select(type: string, id: string | string[], unselectOthers?: boolean, confirm?: boolean): void;
        function unselect(type: string, id: string | string[], confirm?: boolean): void;
        function hover(type: string, id: string | null): void;
        function clear(type: string): void;
        function curSelection(type: string): string[];
        function curActivate(type: string): string;
        function curGlobalActivate(type: string): { type: string, id: string } | null;
        function hovering(type: string): string;
        function contexts(type: string): string[];
        function setContext(type: string, id: string): void;
        function patch(type: string, srcID: string, destID: string): void;
        function filter(items: string[], mode: 'top-level' | 'deep' | 'name', func?: Function): string[];
        function confirm(): void;
        function cancel(): void;
        function confirmed(type: string): boolean;
        function register(type: string): void;
        function reset(): void;
        function local(): any;
    }

    // api/editor-framework/main/panel.md
    namespace Panel {
        function open(panelID: string, argv?: any): void;
        function close(panelID: string, cb?: Function): void;
        function popup(panelID: string): void;
        function findWindow(panelID: string): any;
    }

    // api/editor-framework/main/profile.md
    // load(url, default) tra ve EventEmitter co get/set/remove/save/clear/reset tren prototype.
    // KHONG co getConfig/setConfig — do la API 3.x.
    // ⚠️ VERIFY runtime 2.4.15 (probe phase 2): gan thang property KHONG persist,
    // save() serialize noi bo (_chain), khong doc own-property. PHAI dung .set() roi .save().
    // 'profile://project/' KHONG can register() truoc — editor da register san.
    namespace Profile {
        function load(url: string, defaultProfile?: any): {
            get(key: string): any;
            set(key: string, value: any): void;
            remove(key: string): void;
            save(): void;
            clear(): void;
            reset(): void;
        };
        function register(type: string, path: string): void;
        function reset(): void;
    }

    // working-directory.md — Editor.Project.path la absolute path cua project hien tai.
    namespace Project {
        const path: string;
    }

    // api/editor-framework/main/console.md
    function log(...args: any[]): void;
    function warn(...args: any[]): void;
    function error(...args: any[]): void;
    function info(...args: any[]): void;
    function success(...args: any[]): void;
    function failed(...args: any[]): void;
    function trace(level: string, ...args: any[]): void;
    function clearLog(pattern?: string, useRegex?: boolean): void;
    function connectToConsole(): void;

    // api/editor-framework/main/editor.md
    const argv: any;
    const dev: boolean;
    const lang: string;
    const logfile: string;
    const frameworkPath: string;
    const isClosing: boolean;
    const versions: Record<string, string>;
    function url(url: string): string;
    function require(url: string): any;

    // api/asset-db/asset-db-main.md (mention trong queryAssets):
    // Editor.assettype2name[cc.js.getClassName(asset)] -> ten type dung cho queryAssets.
    const assettype2name: Record<string, string>;
}

// asset-management.md — singleton dieu khien scene instance trong scene editor process.
// CHI ton tai trong scene script, khong co o main process.
declare const _Scene: {
    loadSceneByUuid(uuid: string, cb: (err: Error | null) => void): void;
} | undefined;

// scene-script.md — scene script chay cung environment voi project script.
// Docs 2.4 KHONG cover engine internals; resources/engine/api.d.ts cua Creator 2.4.15
// cung chi khai `declare let cc: { [x: string]: any }`. Giu any, phase 3 probe roi siet.
declare const cc: any;
