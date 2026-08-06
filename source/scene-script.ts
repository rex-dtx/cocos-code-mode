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
    };

})();
