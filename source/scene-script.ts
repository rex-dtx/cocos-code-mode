// Chay trong SCENE PROCESS, cung environment voi project script (assets/).
// KHONG import gi — phai standalone CommonJS. Doc: v2.4/extension/scene-script.md
// Phase 3: chi co handler 'probe' de dump API thuc te + 'echo-args' verify signature.
// ponytail: read-only, khong mutate gi.

// IIFE de helper khong ro ri ra global scope (file khong co import = global script).
(function () {

    function safeKeys(obj: any, limit: number): string[] {
        if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
            return [];
        }
        try {
            return Object.keys(obj).slice(0, limit);
        } catch (e) {
            return ['<throw>'];
        }
    }

    function typeOf(v: any): string {
        if (v === null) { return 'null'; }
        if (v === undefined) { return 'undefined'; }
        if (Array.isArray(v)) { return 'array[' + v.length + ']'; }
        return typeof v;
    }

    // --- helper cho handler read (phase 6) ---

    // BAY 2 (probe phase 3): scene root co 2 node cua editor (objFlags 1096) khong hien
    // o Hierarchy panel. Chi filter O ROOT — con cua chung khong co flag nay.
    function isEditorNode(node: any): boolean {
        const flags = cc.Object && cc.Object.Flags;
        return !!(flags && (node._objFlags & flags.HideInHierarchy));
    }

    function className(obj: any): string | null {
        if (cc.js && cc.js.getClassName) { return cc.js.getClassName(obj); }
        return (obj.constructor && obj.constructor.name) || null;
    }

    // BAY 1 (probe phase 3): cc.view.getDesignResolutionSize() tra size VIEWPORT EDITOR,
    // doi theo keo cua so. Design resolution that nam o component cc.Canvas.
    // --- debug console capture (port from 3x7 scene.ts) ---
    let _catchAllActive = false;
    let _origLog: any = null; let _origWarn: any = null; let _origErr: any = null;
    let _sceneLogFile: string | null = null;
    function _writeSceneLog(level: string, data: any[]): void {
        if (!_sceneLogFile) return;
        const msg = data.map(a => a instanceof Error ? `${a.message}\n${(a as any).stack || ''}` : String(a)).join(' ');
        const line = JSON.stringify({ ts: new Date().toISOString(), level, msg }) + '\n';
        try { const fs: any = require('fs'); fs.appendFileSync(_sceneLogFile, line); } catch {}
    }

    function designResolution(): any {
        const canvasNode = cc.find('Canvas');
        if (!canvasNode) { return null; }
        const canvas = canvasNode.getComponent('cc.Canvas');
        if (!canvas || !canvas.designResolution) { return null; }
        return { width: canvas.designResolution.width, height: canvas.designResolution.height };
    }

    // Asset/Node -> ref thay vi serialize (se circular). cc.SpriteFrame.uuid la getter
    // ke thua, khong phai own-property -> phai check instanceof, khong check `.uuid`.
    function asRef(v: any): any {
        return { __ref: v.uuid || v._uuid || null, __type: className(v), __name: v.name || null };
    }

    function isRefLike(v: any): boolean {
        return (cc.Asset && v instanceof cc.Asset)
            || (cc.Node && v instanceof cc.Node)
            || (cc.Component && v instanceof cc.Component);
    }

    // Field liet ke TUONG MINH: node.uuid/name/x/y la getter, Object.keys khong thay
    // (probe phase 3). Enumerate se mat het field public.
    // `budget` cat theo SO NODE, khong chi theo depth: scene production co the rong
    // hon la sau (1 root, 2000 con) — maxDepth mot minh khong chan duoc.
    function nodeBrief(node: any, depth: number, maxDepth: number, budget: any): any {
        const out: any = {
            name: node.name,
            uuid: node.uuid,
            active: node.active,
            activeInHierarchy: node.activeInHierarchy,
            is3D: node._is3DNode,
            position: { x: node.x, y: node.y },
            scale: { x: node.scaleX, y: node.scaleY },
            angle: node.angle,
            size: { width: node.width, height: node.height },
            anchor: { x: node.anchorX, y: node.anchorY },
            components: (node._components || []).map(function (c: any) {
                return { type: className(c), uuid: c.uuid, enabled: c.enabled };
            }),
        };
        const children = node.children || [];
        out.childrenCount = children.length;
        if (children.length === 0) { return out; }
        if (depth >= maxDepth) {
            out.truncated = 'maxDepth';
            return out;
        }
        out.children = [];
        for (let i = 0; i < children.length; i++) {
            if (budget && budget.left <= 0) {
                out.truncated = 'nodeLimit';
                out.childrenOmitted = children.length - i;
                if (out.children.length === 0) { delete out.children; }
                break;
            }
            if (budget) { budget.left--; }
            out.children.push(nodeBrief(children[i], depth + 1, maxDepth, budget));
        }
        return out;
    }

    module.exports = {

        'probe': function (event: any) {
            const out: any = { errors: [] };

            function tryIt(label: string, fn: () => any) {
                try {
                    out[label] = fn();
                } catch (e: any) {
                    out.errors.push(label + ': ' + (e && e.message));
                }
            }

            // 1. cc namespace
            tryIt('cc_exists', () => typeOf(cc));
            tryIt('cc_keys', () => safeKeys(cc, 80));
            tryIt('cc_js_keys', () => safeKeys(cc.js, 60));
            tryIt('cc_engine_exists', () => typeOf(cc.engine));
            tryIt('cc_director_exists', () => typeOf(cc.director));
            tryIt('cc_view_keys', () => safeKeys(cc.view, 40));

            // 2. Scene root
            tryIt('scene_info', () => {
                const s = cc.director.getScene();
                return {
                    type: typeOf(s),
                    name: s && s.name,
                    uuid: s && s.uuid,
                    childrenCount: s && s.children && s.children.length,
                };
            });

            // 3. Node shape — node dau tien co con, fallback scene root
            tryIt('node_shape', () => {
                const s = cc.director.getScene();
                const n = (s && s.children && s.children[0]) || s;
                if (!n) { return 'no node'; }
                return {
                    name: n.name,
                    publicKeys: safeKeys(n, 60),
                    has_components_private: typeOf(n._components),
                    componentsCount: n._components ? n._components.length : null,
                    has_getComponents: typeOf(n.getComponents),
                    has_angle: typeOf(n.angle),
                    has_rotation: typeOf(n.rotation),
                    has_eulerAngles: typeOf(n.eulerAngles),
                    x: typeOf(n.x),
                    y: typeOf(n.y),
                    scaleX: typeOf(n.scaleX),
                    scaleY: typeOf(n.scaleY),
                    width: typeOf(n.width),
                    height: typeOf(n.height),
                    anchorX: typeOf(n.anchorX),
                    anchorY: typeOf(n.anchorY),
                    has_getComponent: typeOf(n.getComponent),
                    has_uuid: typeOf(n.uuid),
                    has_active: typeOf(n.active),
                    has_activeInHierarchy: typeOf(n.activeInHierarchy),
                };
            });

            // 4. Component shape — component dau tien tim thay trong cay
            tryIt('component_shape', () => {
                const s = cc.director.getScene();
                let found: any = null;
                (function walk(n: any) {
                    if (found || !n) { return; }
                    if (n._components && n._components.length) {
                        found = n._components[0];
                        return;
                    }
                    if (n.children) { n.children.forEach(walk); }
                })(s);
                if (!found) { return 'no component found'; }
                return {
                    className_via_cc_js: (cc.js && cc.js.getClassName)
                        ? cc.js.getClassName(found) : '<no cc.js.getClassName>',
                    ctorName: found.constructor && found.constructor.name,
                    publicKeys: safeKeys(found, 50),
                    has_uuid: typeOf(found.uuid),
                    has_enabled: typeOf(found.enabled),
                    has_node: typeOf(found.node),
                };
            });

            // 5. Class registry — de list valid component type name
            tryIt('class_registry', () => ({
                _registeredClassNames: typeOf(cc.js && cc.js._registeredClassNames),
                count: (cc.js && cc.js._registeredClassNames)
                    ? Object.keys(cc.js._registeredClassNames).length : null,
                sample: (cc.js && cc.js._registeredClassNames)
                    ? Object.keys(cc.js._registeredClassNames).slice(0, 20) : null,
                has_getClassByName: typeOf(cc.js && cc.js.getClassByName),
                has_isChildClassOf: typeOf(cc.js && cc.js.isChildClassOf),
            }));

            // 6. Design resolution
            tryIt('design_resolution', () => {
                if (cc.view && cc.view.getDesignResolutionSize) {
                    const r = cc.view.getDesignResolutionSize();
                    return { width: r.width, height: r.height };
                }
                return '<no cc.view.getDesignResolutionSize>';
            });

            // 7. _Scene singleton (doc: asset-management.md)
            tryIt('_Scene', () => (typeof _Scene !== 'undefined')
                ? { type: typeOf(_Scene), keys: safeKeys(_Scene, 30) }
                : 'undefined');

            // 8. Editor co ton tai trong scene process?
            tryIt('Editor_in_scene', () => (typeof Editor !== 'undefined')
                ? safeKeys(Editor, 40)
                : 'undefined');

            if (event.reply) { event.reply(null, out); }
        },

        // Verify callSceneScript truyen duoc >1 arg (docs khong noi ro)
        'echo-args': function (event: any, a: any, b: any, c: any) {
            if (event.reply) {
                event.reply(null, { a: a, b: b, c: c, argCount: arguments.length - 1 });
            }
        },

        // Probe vong 2: lam ro cac diem probe 1 chua tra loi.
        'probe2': function (event: any) {
            const out: any = { errors: [] };

            function tryIt(label: string, fn: () => any) {
                try {
                    out[label] = fn();
                } catch (e: any) {
                    out.errors.push(label + ': ' + (e && e.message));
                }
            }

            // cc.engine = object (probe 1) — corpus 0 hit nhung TON TAI. Dump ra.
            tryIt('cc_engine', () => ({
                keys: safeKeys(cc.engine, 60),
                proto: safeKeys(Object.getPrototypeOf(cc.engine) || {}, 60),
            }));

            // Node "that" (co component) thay vi 'Editor Scene Background' (node cua editor).
            tryIt('real_node', () => {
                const s = cc.director.getScene();
                let found: any = null;
                (function walk(n: any) {
                    if (found || !n) { return; }
                    if (n._components && n._components.length && n.name !== 'Editor Scene Background') {
                        found = n;
                        return;
                    }
                    if (n.children) { n.children.forEach(walk); }
                })(s);
                if (!found) { return 'not found'; }
                return {
                    name: found.name,
                    parentName: found.parent && found.parent.name,
                    componentCount: found._components.length,
                    componentClassNames: found._components.map((c: any) => cc.js.getClassName(c)),
                    angle: found.angle,
                    rotation: found.rotation,
                    is3D: found._is3DNode,
                    uuid: found.uuid,
                };
            });

            // Editor scene node co bi lan vao hierarchy dump khong -> can filter?
            tryIt('scene_children', () => {
                const s = cc.director.getScene();
                return (s.children || []).map((c: any) => ({
                    name: c.name,
                    uuid: c.uuid,
                    objFlags: c._objFlags,
                    isValidInEditor: (cc.Object && cc.Object.Flags)
                        ? !(c._objFlags & (cc.Object.Flags.HideInHierarchy || 0)) : '<no Flags>',
                }));
            });

            // Flags enum de biet cach filter node cua editor
            tryIt('object_flags', () => (cc.Object && cc.Object.Flags)
                ? cc.Object.Flags : '<no cc.Object.Flags>');

            // getDesignResolutionSize: probe 1 tra 978x322 = size cua editor viewport,
            // KHONG phai design resolution cua project. Doi chieu voi _designResolutionSize.
            tryIt('resolution_compare', () => ({
                getDesignResolutionSize: cc.view.getDesignResolutionSize
                    ? cc.view.getDesignResolutionSize() : null,
                _designResolutionSize: cc.view._designResolutionSize,
                _originalDesignResolutionSize: cc.view._originalDesignResolutionSize,
                canvasNode: (function () {
                    const c = cc.find('Canvas');
                    if (!c) { return 'no Canvas node'; }
                    const canvas = c.getComponent('cc.Canvas');
                    return canvas ? { designResolution: canvas.designResolution } : 'no cc.Canvas comp';
                })(),
            }));

            // _Scene.currentScene — co phai function?
            tryIt('_Scene_currentScene', () => {
                if (typeof _Scene === 'undefined') { return 'undefined'; }
                const cs = (_Scene as any).currentScene;
                if (typeof cs === 'function') {
                    const s = cs();
                    return { type: 'function', returns: s && s.name };
                }
                return { type: typeof cs };
            });

            if (event.reply) { event.reply(null, out); }
        },

        // --- handler read (phase 6) ---

        'scene-snapshot': function (event: any, opts: any) {
            const scene = cc.director.getScene();
            if (!scene) { return event.reply(new Error('no scene open')); }
            const raw = opts && opts.maxDepth;
            const depth = (typeof raw === 'number' && raw > 0) ? raw : 6;
            const rawMax = opts && opts.maxNodes;
            const maxNodes = (typeof rawMax === 'number' && rawMax > 0) ? rawMax : 400;
            const budget = { left: maxNodes };
            const roots = (scene.children || []).filter(function (c: any) { return !isEditorNode(c); });
            const children = roots.map(function (c: any) {
                budget.left--;
                return nodeBrief(c, 1, depth, budget);
            });
            event.reply(null, {
                name: scene.name,
                uuid: scene.uuid,
                designResolution: designResolution(),
                maxDepth: depth,
                maxNodes: maxNodes,
                nodesVisited: maxNodes - budget.left,
                budgetExhausted: budget.left <= 0,
                children: children,
            });
        },

        // cc.find la API docs-confirmed (scene-script.md)
        'node-at-path': function (event: any, opts: any) {
            const node = cc.find(opts && opts.path);
            const raw = opts && opts.maxDepth;
            const depth = (typeof raw === 'number' && raw > 0) ? raw : 3;
            const rawMax = opts && opts.maxNodes;
            const maxNodes = (typeof rawMax === 'number' && rawMax > 0) ? rawMax : 400;
            event.reply(null, node ? nodeBrief(node, 0, depth, { left: maxNodes }) : null);
        },

        'component-props': function (event: any, path: string, compType: string) {
            const node = cc.find(path);
            if (!node) { return event.reply(new Error('node not found: ' + path)); }
            const comp = node.getComponent(compType);
            if (!comp) { return event.reply(new Error('component not found: ' + compType + ' on ' + path)); }
            const out: any = {};
            for (const k in comp) {
                if (k.charAt(0) === '_') { continue; }           // skip private
                let v;
                try { v = comp[k]; } catch (e) { continue; }     // getter co the throw
                const t = typeof v;
                if (t === 'function') { continue; }
                if (v && isRefLike(v)) {
                    out[k] = asRef(v);
                } else if (Array.isArray(v)) {
                    out[k] = v.map(function (item: any) {
                        if (item && typeof item === 'object' && isRefLike(item)) { return asRef(item); }
                        try { return JSON.parse(JSON.stringify(item)); } catch (e) { return '<circular>'; }
                    });
                } else if (v && t === 'object') {
                    try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { out[k] = '<circular>'; }
                } else {
                    out[k] = v;
                }
            }
            event.reply(null, out);
        },

        // scene:query-nodes-by-comp-name chi tra uuid tran; cai nay tra PATH.
        // Path bat dau tu root node (khong gom ten scene) de dung duoc voi cc.find().
        'find-by-component': function (event: any, compType: string, opts: any) {
            const scene = cc.director.getScene();
            if (!scene) { return event.reply(new Error('no scene open')); }
            const rawMax = opts && opts.maxResults;
            const maxResults = (typeof rawMax === 'number' && rawMax > 0) ? rawMax : 200;
            const found: any[] = [];
            let truncated = false;
            function walk(node: any, path: string) {
                if (found.length >= maxResults) { truncated = true; return; }
                const p = path ? path + '/' + node.name : node.name;
                if (node.getComponent && node.getComponent(compType)) {
                    found.push({ path: p, uuid: node.uuid, name: node.name });
                }
                (node.children || []).forEach(function (c: any) { walk(c, p); });
            }
            (scene.children || [])
                .filter(function (c: any) { return !isEditorNode(c); })
                .forEach(function (c: any) { walk(c, ''); });
            event.reply(null, { nodes: found, truncated: truncated, maxResults: maxResults });
        },

        // Chieu NGUOC cua component-props: asset -> node dang dung no. Cau hoi hay hoi
        // truoc khi sua asset ("doi sprite frame nay thi vo cho nao?").
        // 3.x goi Editor.Message.request('scene','query-node-by-asset'); 2.4 KHONG co
        // message do, nhung scene-script co full cc.* nen walk tay duoc.
        // Chi SO uuid roi vut (khong serialize nhu component-props) -> re hon, khong circular.
        'find-by-asset': function (event: any, assetUuid: string, opts: any) {
            if (!assetUuid) { return event.reply(new Error('assetUuid is required')); }
            const scene = cc.director.getScene();
            if (!scene) { return event.reply(new Error('no scene open')); }
            const rawMax = opts && opts.maxResults;
            const maxResults = (typeof rawMax === 'number' && rawMax > 0) ? rawMax : 200;
            const found: any[] = [];
            let truncated = false;

            // BAY 6 (vong 1): cc.SpriteFrame.uuid la getter KE THUA va _uuid la
            // non-enumerable (CCAsset.js:59) -> phai instanceof + fallback _uuid.
            // Object.keys / check `.uuid` own-property deu truot.
            function refUuid(v: any): string | null {
                if (!v || typeof v !== 'object' || !isRefLike(v)) { return null; }
                return v.uuid || v._uuid || null;
            }

            // Tra ten prop (kem index neu nam trong array), null neu khong match.
            // Cung gioi han 2 tang nhu asRef() o vong 1: khong loi vao object long sau.
            function matchedAt(key: string, v: any): string | null {
                if (refUuid(v) === assetUuid) { return key; }
                if (Array.isArray(v)) {
                    for (let i = 0; i < v.length; i++) {
                        if (refUuid(v[i]) === assetUuid) { return key + '[' + i + ']'; }
                    }
                }
                return null;
            }

            function scanComponent(node: any, path: string, comp: any) {
                for (const k in comp) {
                    if (found.length >= maxResults) { truncated = true; return; }
                    if (k.charAt(0) === '_') { continue; }        // skip private
                    let v;
                    try { v = comp[k]; } catch (e) { continue; }  // getter co the throw
                    if (!v || typeof v !== 'object') { continue; }
                    const where = matchedAt(k, v);
                    if (where) {
                        found.push({
                            path: path,
                            uuid: node.uuid,
                            name: node.name,
                            component: className(comp),
                            property: where,
                        });
                    }
                }
            }

            function walk(node: any, parentPath: string) {
                if (found.length >= maxResults) { truncated = true; return; }
                const p = parentPath ? parentPath + '/' + node.name : node.name;
                const comps = node._components || [];
                for (let i = 0; i < comps.length; i++) { scanComponent(node, p, comps[i]); }
                (node.children || []).forEach(function (c: any) { walk(c, p); });
            }

            (scene.children || [])
                .filter(function (c: any) { return !isEditorNode(c); })
                .forEach(function (c: any) { walk(c, ''); });

            event.reply(null, { nodes: found, truncated: truncated, maxResults: maxResults });
        },

        'list-component-classes': function (event: any, filter: string) {
            const reg = cc.js && cc.js._registeredClassNames;
            if (!reg) { return event.reply(new Error('cc.js._registeredClassNames not available')); }
            let names = Object.keys(reg);
            if (filter) { names = names.filter(function (n) { return n.indexOf(filter) !== -1; }); }
            event.reply(null, names.sort());
        },

        'open-scene': function (event: any, uuid: string) {
            if (typeof _Scene !== 'undefined' && _Scene.loadSceneByUuid) {
                _Scene.loadSceneByUuid(uuid, function (err: any) {
                    if (err) { return event.reply(err); }
                    event.reply(null, { ok: true });
                });
            } else {
                event.reply(new Error('_Scene.loadSceneByUuid not available'));
            }
        },

        'scene-info': function (event: any) {
            const scene = cc.director.getScene();
            if (!scene) { return event.reply(new Error('no scene open')); }
            // designResolution helper da co san o scope ngoai
            let dr: any = null;
            try {
                const c = cc.find('Canvas');
                const comp = c && c.getComponent('cc.Canvas');
                if (comp && comp.designResolution) { dr = { width: comp.designResolution.width, height: comp.designResolution.height }; }
            } catch (e) { /* bo qua */ }
            // node count: walk nhe, chi dem — khong build INodeBrief
            let count = 0;
            (function walk(n: any) { count++; (n.children || []).forEach(walk); })(scene);
            event.reply(null, { name: scene.name, uuid: scene.uuid, designResolution: dr, nodesVisited: count });
        },


        'probe-getInstanceById': function (event: any, uuid: any) {
            try {
                const byEngine = cc.engine.getInstanceById(uuid);
                const byFind = cc.find('Canvas'); // control
                event.reply(null, {
                    uuid,
                    engineFound: !!byEngine,
                    engineName: byEngine && byEngine.name,
                    findWorksForComparison: !!byFind,
                    // thử _Scene hoặc cc.director
                    sceneChildren: cc.director.getScene().children.map((c: any) => ({ name: c.name, uuid: c.uuid })),
                });
            } catch (e: any) { event.reply(e); }
        },

        'probe-scene-utils': function (event: any) {
            const out: any = {};
            function tryRequire(url: string) {
                try {
                    const mod = Editor.require(url);
                    return { keys: Object.keys(mod).slice(0, 30), typeof: typeof mod };
                }
                catch (e: any) { return 'ERR: ' + (e && e.message ? e.message : String(e)); }
            }
            // utils sub-modules
            out['scene://utils/node'] = tryRequire('scene://utils/node');
            out['scene://utils/prefab'] = tryRequire('scene://utils/prefab');
            out['scene://utils/scene'] = tryRequire('scene://utils/scene');
            out['scene://utils/animation'] = tryRequire('scene://utils/animation');
            out['scene://edit-mode'] = tryRequire('scene://edit-mode');
            // top-level scene-utils (set-property-by-path.ccc lives here, not under utils/)
            out['scene://set-property-by-path'] = tryRequire('scene://set-property-by-path');
            out['scene://reset-node'] = tryRequire('scene://reset-node');
            out['app://editor/page/scene-utils/utils/node'] = tryRequire('app://editor/page/scene-utils/utils/node');
            out['app://editor/page/scene-utils/set-property-by-path'] = tryRequire('app://editor/page/scene-utils/set-property-by-path');
            out['app://editor/page/scene-utils/reset-node'] = tryRequire('app://editor/page/scene-utils/reset-node');
            // undo modules
            out['scene://undo/index'] = tryRequire('scene://undo/index');
            out['scene://undo/scene-undo-impl'] = tryRequire('scene://undo/scene-undo-impl');
            // dump which Editor APIs exist in scene process
            try { out['Editor_keys'] = Object.keys(Editor).slice(0, 40); } catch (e: any) { out['Editor_keys'] = 'ERR: ' + e.message; }
            try { out['Editor.Undo'] = (Editor as any).Undo ? Object.keys((Editor as any).Undo).slice(0, 20) : 'no Editor.Undo'; } catch (e: any) { out['Editor.Undo'] = 'ERR: ' + e.message; }
            try { out['_Scene_keys'] = typeof _Scene !== 'undefined' ? Object.keys(_Scene).slice(0, 30) : 'no _Scene'; } catch (e: any) { out['_Scene_keys'] = 'ERR: ' + e.message; }
            try {
                const us: any = (_Scene as any);
                if (us && us.Undo) { out['_Scene.Undo_keys'] = Object.keys(us.Undo).slice(0, 20); }
                else { out['_Scene.Undo_keys'] = 'no _Scene.Undo'; }
            } catch (e: any) { out['_Scene.Undo_keys'] = 'ERR: ' + e.message; }
            // cc direct mutation sanity check
            try {
                const n = cc.find('Canvas/background') || cc.find('Canvas');
                out['direct_assign_check'] = n ? { name: n.name, has_x: typeof n.x, has_setPosition: typeof n.setPosition } : 'no node';
            } catch (e: any) { out['direct_assign_check'] = 'ERR: ' + e.message; }
            event.reply(null, out);
        },

        'probe-set-prop': function (event: any, path: any, value: any) {
            const out: any = { errors: [] as string[] };
            function tryIt(label: string, fn: () => any) {
                try { out[label] = fn(); }
                catch (e: any) { out.errors.push(label + ': ' + (e && e.message ? e.message : String(e))); }
            }
            // try every known require path for setProperty
            const candidates = [
                'scene://set-property-by-path',
                'scene://utils/node',
                'app://editor/page/scene-utils/set-property-by-path',
                'app://editor/page/scene-utils/utils/node',
            ];
            for (const url of candidates) {
                tryIt('require:' + url, () => {
                    const mod: any = Editor.require(url);
                    return {
                        has_setProperty: typeof mod.setProperty === 'function',
                        has_setPropertyByPath: typeof mod.setPropertyByPath === 'function',
                        keys: Object.keys(mod).slice(0, 30),
                    };
                });
            }
            tryIt('Editor.Undo_keys', () => (Editor as any).Undo ? Object.keys((Editor as any).Undo).slice(0, 20) : 'no Editor.Undo');
            tryIt('_Scene.Undo_keys', () => typeof _Scene !== 'undefined' && (_Scene as any).Undo ? Object.keys((_Scene as any).Undo).slice(0, 20) : 'no _Scene.Undo');
            tryIt('_Scene_keys', () => typeof _Scene !== 'undefined' ? Object.keys(_Scene).slice(0, 30) : 'no _Scene');
            // IPC scene messages available?
            tryIt('Editor.Ipc_keys', () => Object.keys(Editor.Ipc || {}).slice(0, 20));
            // try actual mutations via different APIs
            if (path) {
                const node = cc.find('Canvas/background') || cc.find('Canvas');
                if (!node) { out.setError = 'no node found'; }
                else {
                    // A) direct cc.Node assignment
                    try {
                        const before = node[path];
                        (node as any)[path] = value;
                        const after = node[path];
                        out.direct_assign = { path, value, before, after, changed: before !== after };
                        // revert
                        (node as any)[path] = before;
                    } catch (e: any) { out.direct_assign_err = e && e.message ? e.message : String(e); }
                    // B) via scene utils setScenePosition etc for position
                    try {
                        if (path === 'x' || path === 'y' || path === 'position') {
                            const utils: any = Editor.require('scene://utils/node');
                            if (typeof utils.setWorldPosition === 'function' || typeof utils.setScenePosition === 'function') {
                                out.position_utils = Object.keys(utils).filter((k: string) => k.toLowerCase().includes('position')).join(',');
                            }
                        }
                    } catch (e: any) { out.position_utils_err = e.message; }
                    // C) via set-property-by-path module
                    for (const url of candidates) {
                        try {
                            const mod: any = Editor.require(url);
                            const fn = mod.setProperty || mod.setPropertyByPath || mod.default;
                            if (typeof fn === 'function') {
                                // try calling with common signatures
                                try { fn(node.uuid, path, value); out['setVia:' + url] = 'ok'; } catch (e2: any) {
                                    try { fn(node, path, value); out['setVia:' + url] = 'ok (node obj)'; } catch (e3: any) {
                                        out['setVia:' + url] = 'ERR: ' + (e2 && e2.message ? e2.message : String(e2));
                                    }
                                }
                                break;
                            }
                        } catch (e: any) { /* ignore */ }
                    }
                }
            }
            event.reply(null, out);
        },

        'probe-mutate': function (event: any, kind: string) {
            // One-shot mutation probes: actually mutate and verify, then revert.
            const out: any = { kind };
            const node = cc.find('Canvas/background') || cc.find('Canvas');
            if (!node) { event.reply(null, { error: 'no node' }); return; }
            const snap = { x: node.x, y: node.y, active: node.active };
            try {
                if (kind === 'direct_x') {
                    const before = node.x;
                    node.x = before + 1;
                    out.before = before; out.after = node.x; out.changed = node.x !== before;
                    node.x = before; // revert
                } else if (kind === 'setWorldPosition') {
                    const utils: any = Editor.require('scene://utils/node');
                    const before = { x: node.x, y: node.y };
                    // setWorldPosition takes (uuid, Vec3)
                    if (typeof utils.setWorldPosition === 'function') {
                        utils.setWorldPosition(node.uuid, { x: before.x + 1, y: before.y, z: 0 });
                        out.changed = node.x !== before.x;
                        utils.setWorldPosition(node.uuid, { x: before.x, y: before.y, z: 0 }); // revert
                    } else { out.error = 'no setWorldPosition'; }
                } else if (kind === 'active') {
                    const before = node.active;
                    node.active = !before;
                    out.before = before; out.after = node.active;
                    node.active = before;
                } else {
                    out.error = 'unknown kind: ' + kind + ' (try: direct_x, setWorldPosition, active)';
                }
            } catch (e: any) { out.error = e && e.message ? e.message : String(e); out.snap = snap; }
            event.reply(null, out);
        },

        'probe-undo': function (event: any) {
            const out: any = {};
            function keysOf(v: any) { try { return Object.keys(v).slice(0, 30); } catch (e: any) { return 'ERR:' + e.message; } }
            out['Editor.Undo'] = (Editor as any).Undo ? keysOf((Editor as any).Undo) : 'no Editor.Undo';
            out['_Scene.Undo'] = typeof _Scene !== 'undefined' && (_Scene as any).Undo ? keysOf((_Scene as any).Undo) : 'no _Scene.Undo';
            out['_Scene'] = typeof _Scene !== 'undefined' ? keysOf(_Scene as any) : 'no _Scene';
            out['Editor.Ipc'] = keysOf(Editor.Ipc || {});
            // try scene IPC undo messages
            const msgs = ['scene:undo', 'scene:redo', 'scene:undo-commit', 'undo', 'redo'];
            out['probe_done'] = true;
            event.reply(null, out);
        },

        'probe-create-node': function (event: any) {
            const out: any = {};
            function tryRequire(url: string) {
                try { const m = Editor.require(url); return Object.keys(m).slice(0, 30); }
                catch (e: any) { return 'ERR:' + (e && e.message ? e.message : String(e)); }
            }
            out['scene://utils/node'] = tryRequire('scene://utils/node');
            out['scene://utils/prefab'] = tryRequire('scene://utils/prefab');
            out['scene://utils/scene'] = tryRequire('scene://utils/scene');
            try { out['cc.Node'] = typeof cc.Node; out['new_cc_Node'] = (() => { const n = new cc.Node('ProbeNode'); return { name: n.name, has_uuid: !!n.uuid }; })(); } catch (e: any) { out['cc.Node'] = 'ERR:' + e.message; }
            try { out['has_createNodeFromAsset'] = typeof (Editor.require('scene://utils/node') as any).createNodeFromAsset === 'function'; } catch (e: any) { out['has_createNodeFromAsset'] = 'ERR:' + e.message; }
            try { out['has_createNodeFromClass'] = typeof (Editor.require('scene://utils/node') as any).createNodeFromClass === 'function'; } catch (e: any) { out['has_createNodeFromClass'] = 'ERR:' + e.message; }
            event.reply(null, out);
        },

        // --- write handlers (probe verified: direct assign x 0→999 OK, direct_x 0→1 OK) ---

        'set-node-prop': function (event: any, uuid: string, path: string, value: any) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(uuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) {
                    if (node || !n) { return; }
                    if (n.uuid === uuid) { node = n; return; }
                    (n.children || []).forEach(walk);
                })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + uuid)); }
            try {
                const parts = path.split('.');
                let cur: any = node;
                for (let i = 0; i < parts.length - 1; i++) {
                    cur = cur[parts[i]];
                    if (cur === undefined || cur === null) { throw new Error('path segment not found: ' + parts.slice(0, i + 1).join('.')); }
                }
                const last = parts[parts.length - 1];
                const before = cur[last];
                cur[last] = value;
                event.reply(null, { uuid, path, before, after: cur[last] });
            } catch (e: any) { event.reply(e); }
        },

        'set-comp-prop': function (event: any, nodeUuid: string, compType: string, path: string, value: any) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(nodeUuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) {
                    if (node || !n) { return; }
                    if (n.uuid === nodeUuid) { node = n; return; }
                    (n.children || []).forEach(walk);
                })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + nodeUuid)); }
            const comp = node.getComponent(compType);
            if (!comp) { return event.reply(new Error('component not found: ' + compType + ' on ' + node.name)); }
            try {
                const parts = path.split('.');
                let cur: any = comp;
                for (let i = 0; i < parts.length - 1; i++) {
                    cur = cur[parts[i]];
                    if (cur === undefined || cur === null) { throw new Error('path segment not found: ' + parts.slice(0, i + 1).join('.')); }
                }
                const last = parts[parts.length - 1];
                const before = cur[last];
                cur[last] = value;
                event.reply(null, { nodeUuid, compType, path, before, after: cur[last] });
            } catch (e: any) { event.reply(e); }
        },

        'create-node': function (event: any, name: string, parentUuid: string) {
            try {
                const node = new cc.Node(name);
                let parent: any = cc.director.getScene();
                if (parentUuid) {
                    try { if (cc.engine && cc.engine.getInstanceById) { parent = cc.engine.getInstanceById(parentUuid) || parent; } } catch (e) {}
                    if (parent.uuid !== parentUuid) {
                        let found: any = null;
                        (function walk(n: any) { if (found || !n) return; if (n.uuid === parentUuid) { found = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
                        if (found) { parent = found; }
                    }
                }
                parent.addChild(node);
                event.reply(null, { uuid: node.uuid, name: node.name, parent: parent.name });
            } catch (e: any) { event.reply(e); }
        },

        'remove-node': function (event: any, uuid: string) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(uuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) { if (node || !n) return; if (n.uuid === uuid) { node = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + uuid)); }
            try { node.removeFromParent(false); event.reply(null, { removed: uuid }); } catch (e: any) { event.reply(e); }
        },

        'add-component': function (event: any, nodeUuid: string, compType: string) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(nodeUuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) { if (node || !n) return; if (n.uuid === nodeUuid) { node = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + nodeUuid)); }
            try {
                const comp = node.addComponent(compType);
                if (!comp) { return event.reply(new Error('addComponent returned null for ' + compType)); }
                event.reply(null, { uuid: comp.uuid || null, type: compType });
            } catch (e: any) { event.reply(e); }
        },

        'remove-component': function (event: any, nodeUuid: string, compType: string) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(nodeUuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) { if (node || !n) return; if (n.uuid === nodeUuid) { node = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + nodeUuid)); }
            const comp = node.getComponent(compType);
            if (!comp) { return event.reply(new Error('component not found: ' + compType)); }
            try { node.removeComponent(comp); event.reply(null, { removed: compType }); } catch (e: any) { event.reply(e); }
        },

        'move-node': function (event: any, uuid: string, newParentUuid: string, siblingIndex: any) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(uuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) { if (node || !n) return; if (n.uuid === uuid) { node = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + uuid)); }
            let newParent: any = null;
            if (newParentUuid) {
                try { if (cc.engine && cc.engine.getInstanceById) { newParent = cc.engine.getInstanceById(newParentUuid); } } catch (e) {}
                if (!newParent) {
                    (function walk(n: any) { if (newParent || !n) return; if (n.uuid === newParentUuid) { newParent = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
                }
                if (!newParent) { return event.reply(new Error('parent not found: ' + newParentUuid)); }
            } else {
                newParent = cc.director.getScene();
            }
            try {
                const keepWorld = true;
                // 2.4: setParent or addChild — try setParent first
                if (typeof node.setParent === 'function') { node.setParent(newParent, keepWorld); }
                else if (typeof node.parent !== 'undefined') { node.removeFromParent(false); newParent.addChild(node); }
                else { newParent.addChild(node); }
                if (typeof siblingIndex === 'number' && siblingIndex >= 0 && typeof node.setSiblingIndex === 'function') {
                    node.setSiblingIndex(siblingIndex);
                }
                event.reply(null, { uuid: node.uuid, parent: newParent.name || newParent.uuid });
            } catch (e: any) { event.reply(e); }
        },

        'startCatchAll': function (event: any) {
            try {
                if (_catchAllActive) return event.reply(null, true);
                let fs: any; try { fs = require('fs'); } catch { return event.reply(null, false); }
                const path = require('path'); const os = require('os');
                const dir = path.join(os.homedir(), '.utcp-debug');
                try { fs.mkdirSync(dir, { recursive: true }); } catch {}
                _sceneLogFile = path.join(dir, `scene-console-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
                _catchAllActive = true;
                _origLog = console.log; _origWarn = console.warn; _origErr = console.error;
                console.log = function(...args: any[]) { _writeSceneLog('log', args); return _origLog.apply(console, args); } as any;
                console.warn = function(...args: any[]) { _writeSceneLog('warn', args); return _origWarn.apply(console, args); } as any;
                console.error = function(...args: any[]) { _writeSceneLog('error', args); return _origErr.apply(console, args); } as any;
                event.reply(null, true);
            } catch (e: any) { event.reply(e); }
        },
        'stopCatchAll': function (event: any) {
            try {
                if (!_catchAllActive) return event.reply(null, true);
                if (_origLog) console.log = _origLog;
                if (_origWarn) console.warn = _origWarn;
                if (_origErr) console.error = _origErr;
                _origLog = _origWarn = _origErr = null;
                _catchAllActive = false; _sceneLogFile = null;
                event.reply(null, true);
            } catch (e: any) { event.reply(e); }
        },
        'create-primitive': function (event: any, type: string, name: string, parentUuid: string) {
            try {
                const node = new (cc as any).Node(name || type);
                // 2.4 has no Editor primitive mesh factory in scene process; create via MeshRenderer + builtin primitive if available
                let parent: any = cc.director.getScene();
                if (parentUuid) {
                    try { if (cc.engine && (cc.engine as any).getInstanceById) parent = (cc.engine as any).getInstanceById(parentUuid) || parent; } catch {}
                    if (parent.uuid !== parentUuid) {
                        let found:any=null; (function walk(n:any){ if(found||!n) return; if(n.uuid===parentUuid){found=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene());
                        if(found) parent = found;
                    }
                }
                // Try to add ModelComponent + primitive mesh if API exists
                try {
                    const map: any = { Cube:'cube', Sphere:'sphere', Capsule:'capsule', Cylinder:'cylinder', Plane:'plane', Quad:'quad', Cone:'cone', Torus:'torus' };
                    const prim = map[type] || 'cube';
                    // cc.utils.createMesh or cc.primitive polyfill is not on 2.4 scene; fallback: add cc.ModelComponent placeholder
                    if (typeof cc.ModelComponent !== 'undefined') {
                        const comp:any = node.addComponent('cc.ModelComponent');
                        // leave mesh null — user can assign via asset in next step
                    }
                } catch {}
                parent.addChild(node);
                event.reply(null, { uuid: node.uuid, name: node.name, parent: parent.name });
            } catch(e:any){ event.reply(e); }
        },
        'probe-animation': function (event: any, uuid: string) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) node = cc.engine.getInstanceById(uuid); } catch(e){}
            if (!node) { (function walk(n:any){ if(node||!n) return; if(n.uuid===uuid){node=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); }
            if (!node) return event.reply(new Error('node not found: '+uuid));
            const anim = node.getComponent('cc.Animation') || node.getComponent(cc.Animation as any);
            if (!anim) return event.reply(new Error('cc.Animation not found on '+node.name));
            const out:any={};
            for(const k in anim){ if(k.charAt(0)==='_') continue; let v; try{v=(anim as any)[k];}catch(e){continue;} if(typeof v==='function') continue;
                if(Array.isArray(v)) out[k]=v.map((it:any)=>{ try{ if(it && (it.uuid||it._uuid)) return {name:it.name||it._name, uuid:it.uuid||it._uuid, duration:it.duration, sample:it.sample, wrapMode:it.wrapMode}; return JSON.parse(JSON.stringify(it)); }catch(e){return String(it);} });
                else if(v && typeof v==='object' && (v.uuid||v._uuid)) out[k]={__ref:v.uuid||v._uuid, __type: (v.constructor&&v.constructor.name)||null, __name:v.name||v._name||null};
                else { try{ out[k]=JSON.parse(JSON.stringify(v)); } catch(e){ out[k]=String(v); } }
            }
            // also expose clips array directly
            try{ const clips=(anim as any).getClips ? (anim as any).getClips() : ((anim as any).clips||(anim as any)._clips||[]); out._clipsResolved = clips.map((cl:any)=>({name:cl.name||cl._name, uuid:cl.uuid||cl._uuid, duration:cl.duration, sample:cl.sample})); }catch(e){}
            event.reply(null, out);
        },
        'duplicate-node': function (event: any, uuid: string) {
            let node: any = null;
            try { if (cc.engine && cc.engine.getInstanceById) { node = cc.engine.getInstanceById(uuid); } } catch (e) {}
            if (!node) {
                (function walk(n: any) { if (node || !n) return; if (n.uuid === uuid) { node = n; return; } (n.children || []).forEach(walk); })(cc.director.getScene());
            }
            if (!node) { return event.reply(new Error('node not found: ' + uuid)); }
            try {
                const clone = cc.instantiate(node);
                clone.name = node.name + '_copy';
                const parent = node.parent || cc.director.getScene();
                parent.addChild(clone);
                event.reply(null, { uuid: clone.uuid, name: clone.name, parent: parent.name });
            } catch (e: any) { event.reply(e); }
        },
    };

})();
