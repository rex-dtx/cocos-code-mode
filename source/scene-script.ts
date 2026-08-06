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
    function nodeBrief(node: any, depth: number, maxDepth: number): any {
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
            out.truncated = true;
            return out;
        }
        out.children = children.map(function (c: any) { return nodeBrief(c, depth + 1, maxDepth); });
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
            const roots = (scene.children || []).filter(function (c: any) { return !isEditorNode(c); });
            event.reply(null, {
                name: scene.name,
                uuid: scene.uuid,
                designResolution: designResolution(),
                maxDepth: depth,
                children: roots.map(function (c: any) { return nodeBrief(c, 1, depth); }),
            });
        },

        // cc.find la API docs-confirmed (scene-script.md)
        'node-at-path': function (event: any, opts: any) {
            const node = cc.find(opts && opts.path);
            const raw = opts && opts.maxDepth;
            const depth = (typeof raw === 'number' && raw > 0) ? raw : 3;
            event.reply(null, node ? nodeBrief(node, 0, depth) : null);
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
        'find-by-component': function (event: any, compType: string) {
            const scene = cc.director.getScene();
            if (!scene) { return event.reply(new Error('no scene open')); }
            const found: any[] = [];
            function walk(node: any, path: string) {
                const p = path ? path + '/' + node.name : node.name;
                if (node.getComponent && node.getComponent(compType)) {
                    found.push({ path: p, uuid: node.uuid, name: node.name });
                }
                (node.children || []).forEach(function (c: any) { walk(c, p); });
            }
            (scene.children || [])
                .filter(function (c: any) { return !isEditorNode(c); })
                .forEach(function (c: any) { walk(c, ''); });
            event.reply(null, found);
        },

        'list-component-classes': function (event: any, filter: string) {
            const reg = cc.js && cc.js._registeredClassNames;
            if (!reg) { return event.reply(new Error('cc.js._registeredClassNames not available')); }
            let names = Object.keys(reg);
            if (filter) { names = names.filter(function (n) { return n.indexOf(filter) !== -1; }); }
            event.reply(null, names.sort());
        },
    };

})();
