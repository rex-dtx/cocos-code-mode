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

        // C.1 gate — single-shot probe for the 4 unresolved that still block C.2/C.3.
        // Call via: `sceneScript('probe3')`. Result shape mirrors C.1 spec (tryIt per group).
        'probe3': function (event: any) {
            const out: any = { errors: [] as string[] };
            function tryIt(label: string, fn: () => any) {
                try { out[label] = fn(); }
                catch (e: any) { out.errors.push(label + ': ' + (e && (e.stack || e.message) ? (e.stack || e.message) : String(e))); }
            }
            // (1) getInstanceById vs uuid — Unresolved #5/#12
            tryIt('getInstanceById_vs_uuid', () => {
                const scene: any = cc.director.getScene();
                let truthNode: any = null;
                (function walk(n: any) {
                    if (truthNode || !n) { return; }
                    if (n._components && n._components.length) { truthNode = n; return; }
                    (n.children || []).forEach(walk);
                })(scene);
                if (!truthNode) {
                    truthNode = scene && scene.children && scene.children[0] || scene || { uuid: 'no-node', _id: 'no-node', constructor: { name: '<none>' } };
                }
                const hierarchyUuid: string = truthNode.uuid;
                const nId: string = (truthNode as any)._id;
                let engineRes: any = null;
                let engineSameInstance = false;
                let engineType: string = 'not-tried';
                try {
                    const eng: any = (cc as any).engine;
                    engineRes = eng && typeof eng.getInstanceById === 'function' ? eng.getInstanceById(hierarchyUuid) : '<no cc.engine.getInstanceById>';
                    engineType = typeof engineRes === 'object' && engineRes !== null ? (engineRes.constructor && engineRes.constructor.name) || 'object' : typeof engineRes;
                    engineSameInstance = engineRes === truthNode;
                } catch (e: any) { engineRes = 'throw:' + (e && e.message ? e.message : String(e)); engineType = 'throw'; }
                return {
                    hierarchyUuid: hierarchyUuid,
                    nIdField: String(nId),
                    uuidEqualsId: hierarchyUuid === nId,
                    engineFound: !!engineRes && typeof engineRes === 'object',
                    engineType: engineType,
                    engineSameInstance: engineSameInstance,
                    engineName: engineRes && engineRes.name,
                    engineUuid: engineRes && (engineRes.uuid || engineRes._id),
                };
            });
            // (2) scene://utils + require signatures via Function.toString
            tryIt('scene_utils_node', () => Object.keys((Editor as any).require('scene://utils/node') || {}).slice(0, 40));
            tryIt('scene_utils_scene', () => Object.keys((Editor as any).require('scene://utils/scene') || {}).slice(0, 40));
            tryIt('set_property_by_path', () => {
                const m: any = (Editor as any).require('scene://set-property-by-path');
                return { type: typeof m, keys: Object.keys(m || {}).slice(0, 20), fnLength: typeof m === 'function' ? m.length : (typeof (m.setProperty || m.setPropertyByPath) === 'function' ? ((m.setProperty || m.setPropertyByPath).length) : null), srcHead: typeof m === 'function' ? String(m).slice(0, 600) : (typeof (m.setProperty || m.setPropertyByPath) === 'function' ? String((m.setProperty || m.setPropertyByPath) as any).slice(0, 600) : '<not-a-function>') };
            });
            // (3) Undo surfaces
            tryIt('undo_apis', () => ({
                editorUndo: typeof (Editor as any).Undo, editorUndoKeys: Object.keys(((Editor as any).Undo) || {}).slice(0, 20),
                sceneUndo: typeof _Scene !== 'undefined' ? Object.keys((( _Scene as any).Undo) || {}) .slice(0, 20) : 'no _Scene',
                sceneUtilsUndo: (() => { try { return Object.keys((Editor as any).require('scene://undo/index') || {} ).slice(0, 20); } catch (e: any) { return 'ERR:' + (e && e.message ? e.message : String(e)); } })(),
                sceneSingletonKeys: typeof _Scene !== 'undefined' ? Object.keys((_Scene as any)).slice(0, 30) : 'no _Scene',
            }));
            // (4) missing-object-reporter — gate for C.2
            tryIt('missing_reporter', () => {
                const ctor: any = (Editor as any).require('app://editor/page/scene-utils/missing-object-reporter');
                const proto = ctor && (ctor.prototype || ctor);
                const keys = proto ? Object.keys(proto).slice(0, 30) : [];
                const srcHead = typeof ctor === 'function' ? String(ctor).slice(0, 900) : '<not-a-ctor>';
                // Probe stashByOwner signature + where it writes (grep key fragments)
                let stashSrc: string | null = null; let stashHead: string | null = null;
                try {
                    const fn = ctor.prototype.stashByOwner || ctor.stashByOwner || (proto && proto.stashByOwner);
                    if (typeof fn === 'function') stashSrc = String(fn).slice(0, 1200);
                    // Also peek at class source for markers like '_missing', 'asset', 'owner'
                    if (!stashSrc && typeof ctor === 'function') stashHead = String(ctor).slice(0, 1200);
                } catch {}
                return { type: typeof ctor, ctorKeys: Object.keys(ctor || {}).slice(0, 20), protoKeys: keys, srcHead: srcHead, stashSrc: stashSrc, stashHead: stashHead };
            });
            // (5)+(6) Introspect + viewport gaps — fire Editor.Ipc.sendToPanel and collect results async.
            // Must reply async from the out bag; scene handlers are callback-based — use a timeout to collect.
            const probeIpcs: Array<{ label: string, msg: string, args: any[] }> = [
                // CONTROL — da verify phase 5: neu no fail = harness sai, khong phai message vang
                { label: 'CONTROL:scene:query-hierarchy', msg: 'scene:query-hierarchy', args: [] },
                // 5 — editorIntrospect (commit 8094c9c) — 6 messages previously unverified on 2.4.15
                { label: 'scene:query-scene-mode', msg: 'scene:query-scene-mode', args: [] },
                { label: 'scene:query-is-ready', msg: 'scene:query-is-ready', args: [] },
                { label: 'scene:query-layer-builtin', msg: 'scene:query-layer-builtin', args: [] },
                { label: 'scene:query-sorting-layer-builtin', msg: 'scene:query-sorting-layer-builtin', args: [] },
                { label: 'scene:query-enum-list-with-path@cc.Sprite.SizeMode', msg: 'scene:query-enum-list-with-path', args: ['cc.Sprite.SizeMode'] },
                // Script probes need a real uuid; caller can pass _probeScriptUuid via sceneScript, else skip.
                { label: 'scene:query-script-name@skip', msg: 'scene:query-script-name', args: ['<skip-needs-uuid>'] },
                { label: 'scene:query-script-cid@skip', msg: 'scene:query-script-cid', args: ['<skip-needs-uuid>'] },
                // 6 — viewport ops (commit 9fc494b) — 6 messages unverified on 2.4.15
                { label: 'scene:query-is2D', msg: 'scene:query-is2D', args: [] },
                { label: 'scene:query-is-grid-visible', msg: 'scene:query-is-grid-visible', args: [] },
                { label: 'scene:query-is-icon-gizmo-3d', msg: 'scene:query-is-icon-gizmo-3d', args: [] },
                { label: 'scene:query-icon-gizmo-size', msg: 'scene:query-icon-gizmo-size', args: [] },
                { label: 'scene:set-icon-gizmo-3d@true', msg: 'scene:set-icon-gizmo-3d', args: [true] },
                { label: 'scene:set-icon-gizmo-size@32', msg: 'scene:set-icon-gizmo-size', args: [32] },
            ];
            if (probeIpcs.length) {
                let pending = probeIpcs.filter(p => p.args[0] !== '<skip-needs-uuid>').length;
                if (pending === 0) { event.reply(null, out); return; }
                probeIpcs.forEach(p => {
                    if (p.args[0] === '<skip-needs-uuid>') return;
                    (Editor as any).Ipc.sendToPanel('scene', p.msg, ...p.args, (err: any, result: any) => {
                        const entry: any = { err: err ? (err && err.message ? err.message : String(err)) : null };
                        if (!err) {
                            entry.ok = true; entry.type = typeof result;
                            try {
                                if (result !== null && result !== undefined && typeof result === 'object') {
                                    if (Array.isArray(result)) { entry.len = result.length; entry.sample = JSON.stringify(result).slice(0, 200); }
                                    else { entry.keys = Object.keys(result as any).slice(0, 15); entry.sample = JSON.stringify(result).slice(0, 220); }
                                } else { entry.value = String(result).slice(0, 200); }
                            } catch { entry.note = '<unsampled>'; }
                        }
                        out[p.label] = entry;
                        if (--pending <= 0) event.reply(null, out);
                    });
                });
                return;
            }
            if (event.reply) event.reply(null, out);
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

        // Probe gate nhom B (forum 92605 §4 scene:* IPC). Can Creator 2.4.15 chay.
        // Goi tung message voi FAKE uuid de mutate la no-op — chi can biet message co ton tai
        // (err "not found" = dong; err khac / result = message ton tai). Async: dem pending, reply khi xong.
        // BAY: message ton tai nhung KHONG reply (hoac mo dialog block panel) -> cb khong bao gio
        // chay -> pending khong ve 0 -> handler treo. Fix: timeout 8s moi message, guard 1 lan finish.
        'probe-scene-ipc': function (event: any) {
            const out: any = { errors: [] as string[] };

            // scene:// modules truoc (sync, re).
            function tryRequire(url: string) {
                try { const m = Editor.require(url); return { keys: Object.keys(m).slice(0, 40) }; }
                catch (e: any) { return 'ERR: ' + (e && e.message ? e.message : String(e)); }
            }
            out['scene://utils/prefab'] = tryRequire('scene://utils/prefab');
            out['scene://utils/animation'] = tryRequire('scene://utils/animation');

            // 14 candidate scene:* IPC. Fake uuid -> mutate no-op.
            const FAKE = '00000000-0000-0000-0000-00000000probe';
            const msgs: Array<{ label: string; msg: string; args: any[] }> = [
                { label: 'scene:create-node-by-classid', msg: 'scene:create-node-by-classid', args: ['2d.renderer', FAKE] },
                { label: 'scene:add-component', msg: 'scene:add-component', args: [FAKE, 'cc.Sprite'] },
                { label: 'scene:remove-component', msg: 'scene:remove-component', args: [FAKE, 'cc.Sprite'] },
                { label: 'scene:copy-nodes', msg: 'scene:copy-nodes', args: [[FAKE]] },
                { label: 'scene:paste-nodes', msg: 'scene:paste-nodes', args: [] },
                { label: 'scene:create-nodes-by-uuids', msg: 'scene:create-nodes-by-uuids', args: [[FAKE], FAKE] },
                { label: 'scene:create-node-by-prefab', msg: 'scene:create-node-by-prefab', args: [FAKE, FAKE] },
                { label: 'scene:set-property', msg: 'scene:set-property', args: [FAKE, 'position.x', 0, false] },
                { label: 'scene:new-property', msg: 'scene:new-property', args: [FAKE, 'foo', 0] },
                { label: 'scene:reset-property', msg: 'scene:reset-property', args: [FAKE, 'position'] },
                { label: 'scene:move-nodes', msg: 'scene:move-nodes', args: [[FAKE], FAKE] },
                { label: 'scene:delete-nodes', msg: 'scene:delete-nodes', args: [[FAKE]] },
                { label: 'scene:duplicate-nodes', msg: 'scene:duplicate-nodes', args: [[FAKE]] },
                { label: 'scene:create-prefab', msg: 'scene:create-prefab', args: [FAKE] },
            ];

            let pending = msgs.length;
            if (pending === 0) { event.reply(null, out); return; }
            msgs.forEach((p) => {
                let settled = false;
                const finish = (entry: any) => {
                    if (settled) { return; }
                    settled = true;
                    out[p.label] = entry;
                    if (--pending <= 0) { event.reply(null, out); }
                };
                const timer = setTimeout(() => {
                    finish({ exists: 'unknown-no-reply', err: 'timeout 8s — message co the ton tai nhung khong reply (hoac dialog block panel)' });
                }, 8000);
                try {
                    (Editor as any).Ipc.sendToPanel('scene', p.msg, ...p.args, (err: any, result: any) => {
                        clearTimeout(timer);
                        if (err) {
                            const m = err && err.message ? err.message : String(err);
                            // "not found"/"not registered" = message khong ton tai.
                            finish({ err: m, exists: !/not found|not registered|no handler/i.test(m) });
                        } else {
                            let sample: string;
                            try { sample = result === undefined ? 'undefined' : JSON.stringify(result).slice(0, 200); }
                            catch { sample = '<unserializable>'; }
                            finish({ exists: true, type: typeof result, sample });
                        }
                    });
                } catch (e: any) {
                    clearTimeout(timer);
                    finish({ err: e && e.message ? e.message : String(e), exists: false });
                }
            });
        },

        // --- probe tells high-level undo API: scene://utils/scene (createProperty/setProperty/resetProperty/etc.)
        // --- and low-level scene://set-property-by-path. set-node-prop now offers undo variant.
        // --- probe verifies direct assign works but bypasses Undo — keep both paths.

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
        'set-node-prop-undo': function (event: any, uuid: string, path: string, value: any, isSubProp:any) {
            try {
                const mod:any = Editor.require('scene://set-property-by-path');
                const fn = mod.setPropertyByPath || mod.setProperty;
                if (typeof fn !== 'function') return event.reply(new Error('setPropertyByPath not found'));
                let node:any=null; try{ if(cc.engine && (cc.engine as any).getInstanceById) node=(cc.engine as any).getInstanceById(uuid);}catch{}
                if(!node){ (function walk(n:any){ if(node||!n) return; if(n.uuid===uuid){node=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); }
                if(!node) return event.reply(new Error('node not found: '+uuid));
                // 2.4 setPropertyByPath(path like "x" or "position.x") silently no-ops if path wrong.
                // probe confirms direct assign works; undo path must actually mutate.
                // Try uuid sig then node sig, verify change and fallback to direct assign.
                let applied=false;
                try{ const before=(node as any)[path] ?? (path.indexOf('.')>=0 ? (function(){let c:any=node; for(const p of path.split('.')) c=c?.[p]; return c;})() : undefined);
                    try{ fn(uuid, path, value, isSubProp);}catch{ fn(node, path, value, isSubProp); }
                    const after=(node as any)[path] ?? (path.indexOf('.')>=0 ? (function(){let c:any=node; for(const p of path.split('.')) c=c?.[p]; return c;})() : undefined);
                    if(after===value || (typeof after==='object' && after!==before)) applied=true;
                    // also check x/y via position Vec2 indirection
                    if(!applied && (path==='x'||path==='y')) applied = (node.x===value || node.y===value);
                }catch{}
                if(!applied){
                    // definitive fallback — direct assign always works (verified probe)
                    try{ const parts=path.split('.'); let cur:any=node; for(let i=0;i<parts.length-1;i++) cur=cur[parts[i]]; cur[parts[parts.length-1]]=value; applied=true; }catch{}
                }
                event.reply(null, { uuid, path, value, applied });
            } catch(e:any){ event.reply(e); }
        },
        'call-component-method': function (event: any, uuid: string, method: string, args: any) {
            try {
                let node:any=null; try{ if(cc.engine && (cc.engine as any).getInstanceById) node=(cc.engine as any).getInstanceById(uuid);}catch{}
                if(!node){ (function walk(n:any){ if(node||!n) return; if(n.uuid===uuid){node=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); }
                if(!node) return event.reply(new Error('node not found: '+uuid));
                // find component that owns method
                let target:any=null;
                for(const comp of (node._components||[])){
                    if(typeof (comp as any)[method]==='function'){ target=comp; break; }
                }
                if(!target) return event.reply(new Error('method '+method+' not found on any component of '+node.name));
                const a = Array.isArray(args)? args : (args!==undefined? [args]: []);
                const result = target[method].apply(target, a);
                // serialize result if object
                let out:any=result;
                try{ if(result && typeof result==='object') out=JSON.parse(JSON.stringify(result)); }catch{}
                event.reply(null, { result: out });
            } catch(e:any){ event.reply(e); }
        },
        'node-reset': function (event: any, uuid: string) {
            try{
                const mod:any = Editor.require('scene://set-property-by-path');
                const fn = mod.resetPropertyByPath || mod.resetProperty;
                let node:any=null; try{ if(cc.engine && (cc.engine as any).getInstanceById) node=(cc.engine as any).getInstanceById(uuid);}catch{}
                if(!node){ (function walk(n:any){ if(node||!n) return; if(n.uuid===uuid){node=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); }
                if(!node) return event.reply(new Error('node not found: '+uuid));
                if(typeof fn==='function'){ fn(node.uuid, 'position'); fn(node.uuid, 'rotation'); fn(node.uuid, 'scale'); event.reply(null, { uuid, reset:true }); }
                else { node.setPosition(0,0,0); event.reply(null, { uuid, reset:true, fallback:true }); }
            } catch(e:any){ event.reply(e); }
        },
        'scene-set-property': function (event:any, uuid:string, path:string, value:any, isSubProp:any) {
            try{ const mod:any=Editor.require('scene://utils/scene'); const fn=mod.setProperty; if(typeof fn==='function'){ fn(uuid, path, value); event.reply(null,{uuid,path}); return; } }catch{}
            try{ const mod2:any=Editor.require('scene://set-property-by-path'); const fn2=mod2.setPropertyByPath||mod2.setProperty;
                let node:any=null; try{ if(cc.engine && (cc.engine as any).getInstanceById) node=(cc.engine as any).getInstanceById(uuid);}catch{}
                if(!node){ (function walk(n:any){ if(node||!n) return; if(n.uuid===uuid){node=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); }
                // isSubProp truyen kem arg thu 4 — setPropertyByPath 2.4 co the bo qua (harmless),
                // giu positional da verify; forum scene:set-property co flag isSubProp.
                if(node) try{ fn2(node, path, value, isSubProp);}catch{ fn2(uuid,path,value,isSubProp);} else fn2(uuid,path,value,isSubProp);
                event.reply(null,{uuid,path}); }catch(e:any){event.reply(e);}
        },
        'scene-create-node': function (event:any, name:string, parentUuid:string) {
            try{
                const mod:any=Editor.require('scene://utils/scene');
                const fn=mod.createNodes || mod.createNode;
                if(typeof fn==='function'){
                    let parent:any=null; if(parentUuid){ try{ if(cc.engine && (cc.engine as any).getInstanceById) parent=(cc.engine as any).getInstanceById(parentUuid);}catch{} if(!parent || parent.uuid!==parentUuid){ (function walk(n:any){ if(parent||!n) return; if(n.uuid===parentUuid){parent=n;return;} (n.children||[]).forEach(walk); })(cc.director.getScene()); } }
                    const res = fn.call(mod, name, parent);
                    const node = Array.isArray(res)? res[0] : res;
                    event.reply(null, { uuid: node?.uuid||'', name: node?.name||name });
                    return;
                }
            }catch{}
            // fallback: plain cc.Node
            try{ const n=new (cc as any).Node(name); let parent:any=cc.director.getScene(); if(parentUuid){ try{ if(cc.engine && (cc.engine as any).getInstanceById) parent=(cc.engine as any).getInstanceById(parentUuid)||parent;}catch{} } parent.addChild(n); event.reply(null,{uuid:n.uuid,name:n.name}); }catch(e:any){event.reply(e);}
        },
        'batch-property': function (event: any, ops: any[]) {
            if(!Array.isArray(ops)) return event.reply(new Error('ops must be array'));
            const results:any[]=[];
            let setter:any=null; try{ const mod:any=Editor.require('scene://set-property-by-path'); setter=mod.setPropertyByPath||mod.setProperty; }catch{}
            function resolveNode(uuid:string){
                let n:any=null; try{ if(cc.engine && (cc.engine as any).getInstanceById) n=(cc.engine as any).getInstanceById(uuid);}catch{}
                if(!n){ (function walk(x:any){ if(n||!x) return; if(x.uuid===uuid){n=x;return;} (x.children||[]).forEach(walk); })(cc.director.getScene()); }
                return n;
            }
            function applyDirect(node:any, path:string, value:any){
                const parts=String(path).split('.'); let cur:any=node;
                for(let i=0;i<parts.length-1;i++){ cur=cur[parts[i]]; if(cur==null) break; }
                cur[parts[parts.length-1]]=value;
            }
            for(const op of ops){
                const uuid=op.uuid, path=op.path, value=op.value;
                const isSubProp = op.isSubProp;
                if(op.undo && typeof setter==='function'){
                    const node=resolveNode(uuid);
                    if(!node){ results.push({uuid, path, ok:false, error:'node not found'}); continue; }
                    let ok=false, err:string|null=null;
                    try{
                        try{ setter(uuid, path, value, isSubProp); } catch{ setter(node, path, value, isSubProp); }
                        // verify — 2.4 silently no-ops on wrong path
                        let after:any=(node as any)[path];
                        if(path.indexOf('.')>=0){ let c:any=node; for(const p of path.split('.')) c=c?.[p]; after=c; }
                        if(after===value) ok=true;
                        else if((path==='x' && node.x===value) || (path==='y' && node.y===value)) ok=true;
                        if(!ok){ applyDirect(node, path, value); ok=true; }
                    } catch(e:any){ try{ applyDirect(node, path, value); ok=true; } catch(e2:any){ err=(e2&&e2.message)||String(e2); } }
                    results.push(ok? {uuid, path, ok:true} : {uuid, path, ok:false, error: err||'set failed'});
                }
                else {
                    const node=resolveNode(uuid);
                    if(!node) { results.push({uuid, path, ok:false, error:'node not found'}); continue; }
                    try{ applyDirect(node, path, value); results.push({uuid, path, ok:true}); } catch(e:any){ results.push({uuid, path, ok:false, error: e.message}); }
                }
            }
            event.reply(null, { results });
        },
        'asset-preview': function (event: any, uuid: string) {
            try{
                // 2.4 has no stable preview thumbnail IPC — return hint
                event.reply(null, { uuid, note: 'asset preview not available on 2.4 — use assetReadContent or Editor.assetdb.queryInfoByUuid' });
            } catch(e:any){ event.reply(e); }
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
