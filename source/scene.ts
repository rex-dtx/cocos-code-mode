export function load() { }
export function unload() { }
let _originalConsoleError: (...data: unknown[]) => void = () => { };
let _caughtLogs: string[] = [];

// ponytail: debug console capture for scene process — writes JSONL to
// ~/.utcp-debug/scene-console-*.jsonl. Uses dynamic require('fs') because
// this file runs in the editor's scene renderer where node builtins are available.
let _catchAllActive = false;
let _origLog: typeof console.log | null = null;
let _origWarn: typeof console.warn | null = null;
let _origErr: typeof console.error | null = null;
let _sceneLogFile: string | null = null;

function _writeSceneLog(level: 'log' | 'warn' | 'error', data: unknown[]): void {
    if (!_sceneLogFile) return;
    const msg = data.map(a => a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a)).join(' ');
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg }) + '\n';
    try {
        // ponytail: appendFileSync per entry — debug mode is opt-in and volume low.
        // Accepts slight sync overhead over buffering+flush for simplicity.
        const fs = require('fs');
        fs.appendFileSync(_sceneLogFile, line);
    } catch {}
}

function getSceneExecuteGlobals(): Record<string, any> {
    // Inject scene-renderer globals explicitly — new Function has no closure access.
    // `cc`/`cce`/`document` are reliably present in the editor scene; `require` is
    // guarded because fs may be unavailable in some scene sub-contexts.
    return {
        cc: (globalThis as any)['cc'],
        cce: (globalThis as any)['cce'],
        document,
        require: typeof require === 'function' ? require : undefined,
    };
}

export const methods = {
    async startCatchLogging() {
        _caughtLogs = [];
        _originalConsoleError = console.error;
        console.error = (...data: unknown[]) => {
            const msg = data.map(a => a instanceof Error ? a.message : a).join(' ');
            _caughtLogs.push(msg);
            _originalConsoleError(...data);
        }
    },

    async stopCatchLogging(): Promise<string[]> {
        console.error = _originalConsoleError;
        return _caughtLogs;
    },

    async startCatchAll(): Promise<boolean> {
        if (_catchAllActive) return true;
        let fs: any;
        try { fs = require('fs'); } catch {
            console.warn('[cc-bridge-3x] startCatchAll: fs unavailable in scene context');
            return false;
        }
        const path = require('path');
        const os = require('os');
        const dir = path.join(os.homedir(), '.utcp-debug');
        try { fs.mkdirSync(dir, { recursive: true }); } catch {}
        _sceneLogFile = path.join(dir, `scene-console-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
        _catchAllActive = true;
        _origLog = console.log;
        _origWarn = console.warn;
        _origErr = console.error;
        console.log = (...args: unknown[]) => { _writeSceneLog('log', args); _origLog!(...args); };
        console.warn = (...args: unknown[]) => { _writeSceneLog('warn', args); _origWarn!(...args); };
        console.error = (...args: unknown[]) => { _writeSceneLog('error', args); _origErr!(...args); };
        return true;
    },

    async stopCatchAll(): Promise<void> {
        if (!_catchAllActive) return;
        if (_origLog) console.log = _origLog;
        if (_origWarn) console.warn = _origWarn;
        if (_origErr) console.error = _origErr;
        _origLog = _origWarn = _origErr = null;
        _catchAllActive = false;
        _sceneLogFile = null;
    },

    async createPrefabFromNode(nodeUuid: string, path: string): Promise<string> {
        const cce = (globalThis as any)['cce'];
        
        if (!cce || !cce.Prefab || !cce.Prefab.createPrefabAssetFromNode) {
            throw new Error('CCE API not found');
        }

        return await cce.Prefab.createPrefabAssetFromNode(nodeUuid, path);
    },

    async applyPrefabByNode(nodeUuid: string): Promise<string | null> {
        try {
            const cce = (globalThis as any)['cce'];
            if (!cce || !cce.Prefab || !cce.Prefab.applyPrefab) {
                throw new Error('CCE API not found');
            }

            const success: boolean = await cce.Prefab.applyPrefab(nodeUuid);
            if (!success) {
                throw new Error('Failed to apply prefab');
            } else {
                return null;
            }
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    },

    async unlinkPrefabByNode(nodeUuid: string, recursive: boolean): Promise<string | null> {
        try {
            const cce = (globalThis as any)['cce'];
            if (!cce || !cce.Prefab || !cce.Prefab.unWrapPrefabInstance) {
                throw new Error('CCE API not found');
            }

            const success: boolean = await cce.Prefab.unWrapPrefabInstance(nodeUuid, recursive);
            if (!success) {
                throw new Error('Failed to unlink prefab');
            } else {
                return null;
            }
        } catch (error) {
             return error instanceof Error ? error.message : String(error);
        }
    },

    async createOffscreenCanvas(width: number, height: number): Promise<HTMLCanvasElement> {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    },

    async captureScreenshot(
        imageSize: { width: number, height: number } = { width: 512, height: 512 },
        jpegQuality: number = 80,
        cameraPosition?: { x: number, y: number, z: number },
        targetPosition?: { x: number, y: number, z: number },
        orthographic: boolean = false,
        orthographicSize: number = 10
    ): Promise<string> {
        // A bare number (or any non-{width,height} shape) used to reach root.resize()
        // as undefined, producing a 0x0 canvas whose toDataURL() is the string
        // "data:," — which then shipped as a valid-looking but empty JPEG. Fail
        // loudly instead, and accept the square-size shorthand while we're here.
        if (typeof imageSize === 'number') {
            imageSize = { width: imageSize, height: imageSize };
        }
        const width = Math.floor(imageSize?.width ?? 0);
        const height = Math.floor(imageSize?.height ?? 0);
        if (!(width > 0) || !(height > 0)) {
            throw new Error(`captureScreenshot: imageSize must be {width,height} with positive values, got ${JSON.stringify(imageSize)}`);
        }
        imageSize = { width, height };

        return new Promise((resolve, reject) => {
            const cce = (globalThis as any)['cce'];
            const cc = (globalThis as any)['cc'];

            let prevWidth: number;
            let prevHeight: number;

            // Optional: Save camera state
            let prevCamPos: any;
            let prevCamRot: any;
            let prevProjection: number;
            let prevOrthoSize: number;
            
            // Apply Camera Changes
            try {
                if (cce && cce.Camera && cce.Camera.camera) {
                    const camNode = cce.Camera.camera.node;

                    if (camNode) {
                        prevCamPos = camNode.position.clone();
                        prevCamRot = camNode.rotation.clone();
                        prevProjection = cce.Camera.camera.projection;
                        prevOrthoSize = cce.Camera.camera.orthoSize;

                        cce.Camera.camera.projection = orthographic ? 
                            cc.Camera.ProjectionType.ORTHO : cc.Camera.ProjectionType.PERSPECTIVE;

                        if (orthographic) {
                            cce.Camera.camera.orthoSize = orthographicSize;
                        }

                        if (cameraPosition) {
                            camNode.setPosition(new cc.Vec3(cameraPosition.x ?? 0, cameraPosition.y ?? 0, cameraPosition.z ?? 0));
                        }
                        if (targetPosition) {
                            camNode.lookAt(new cc.Vec3(targetPosition.x ?? 0, targetPosition.y ?? 0, targetPosition.z ?? 0));
                        }
                        
                        if (cce.Camera.refresh) cce.Camera.refresh();
                    }
                }
            } catch (e) {
                console.warn("[captureScreenshot] Failed to modify camera:", e);
            }

            if (cc.director && cc.director.root) {
                prevWidth = cc.director.root.mainWindow?.width || 0;
                prevHeight = cc.director.root.mainWindow?.height || 0;
                cc.director.root.resize(imageSize.width, imageSize.height);
            } else {
                return reject(new Error("cc.game.canvas not found or is not an HTMLCanvasElement"));
            }
            
            try {
                if (cce && cce.Engine) {
                    cce.Engine.repaintInEditMode();
                }
            } catch (e) { console.warn("Failed to repaintInEditMode:", e); }

            cc.director.once(cc.Director.EVENT_AFTER_RENDER, () => {
                try {
                    if (cc.game && cc.game.canvas && (cc.game.canvas instanceof HTMLCanvasElement)) {
                        const dataURL = cc.game.canvas.toDataURL('image/jpeg', jpegQuality / 100);
                        const base64 = dataURL.replace(/^data:image\/\w+;base64,/, '');
                        resolve(base64);
                    } else {
                        reject(new Error("cc.game.canvas not found or is not an HTMLCanvasElement"));
                    }
                } catch (error: any) {
                     reject(new Error(error.message || String(error)));
                } finally {
                    // Restore previous size
                    if (cc.director && cc.director.root) {
                        cc.director.root.resize(prevWidth, prevHeight);
                    }
                    // Restore camera
                    setTimeout(() => {
                        if (cce && cce.Camera && cce.Camera.camera && cce.Camera.camera.node) {
                            if (prevCamPos) cce.Camera.camera.node.setPosition(prevCamPos);
                            if (prevCamRot) cce.Camera.camera.node.setRotation(prevCamRot);
                            if (prevProjection !== undefined) cce.Camera.camera.projection = prevProjection;
                            if (prevOrthoSize !== undefined) cce.Camera.camera.orthoSize = prevOrthoSize;
                            if (cce.Camera.refresh) cce.Camera.refresh();
                        }
                    }, 50);
                }
            });
        });
    },

    async runCode(code: string, args?: any): Promise<any> {
        // Generic JS execution escape hatch in the scene renderer. Globals are injected
        // explicitly and kept in getSceneExecuteGlobals so future globals are a one-line
        // add. Uses an async wrapper so the agent can `await` and `return <expr>`.
        const globals = getSceneExecuteGlobals();
        const names = Object.keys(globals);
        const values = Object.values(globals);
        const fn = new Function('args', ...names, `return (async () => { ${code} })();`) as (...v: any[]) => Promise<any>;
        const result = await fn(args ?? {}, ...values);
        if (result === undefined || result === null) return null;
        // Coerce to JSON-safe BEFORE crossing IPC: the Editor.Message transport
        // JSON-serializes this return value in the scene process, so a circular
        // object or live cc.Node would throw "Converting circular structure to JSON"
        // where the editor-side serializeGuard cannot intercept it. Mirror that guard
        // here so scene-context returns are as safe as editor-context returns.
        try {
            JSON.stringify(result);
            return result; // already serializable — skip the extra round-trip
        } catch {
            const seen = new WeakSet();
            try {
                return JSON.parse(JSON.stringify(result, (_key, val) => {
                    if (typeof val === 'function' || typeof val === 'bigint' || typeof val === 'symbol') return undefined;
                    if (val && typeof val === 'object') {
                        if (seen.has(val)) return undefined; // circular
                        seen.add(val);
                    }
                    return val;
                }));
            } catch {
                return null; // pathologically non-serializable — fail soft, not crash
            }
        }
    },

    async runtimePause(): Promise<boolean> {
        const cc = (globalThis as any)['cc'];
        if (!cc?.game) return false;
        cc.game.pause();
        return true;
    },

    async runtimeResume(): Promise<boolean> {
        const cc = (globalThis as any)['cc'];
        if (!cc?.game) return false;
        cc.game.resume();
        return true;
    },

    async runtimeSetTimeScale(scale: number): Promise<boolean> {
        const cc = (globalThis as any)['cc'];
        if (!cc?.director) return false;
        const scheduler = cc.director.getScheduler();
        if (!scheduler) return false;
        scheduler.setTimeScale(scale);
        return true;
    },

    // Finds a live runtime node by uuid in the editor scene graph. The scene panel
    // runs the full engine, so cc.director.getScene() holds real cc.Node instances
    // (distinct from the editor-side dump returned by query-node).
    async findRuntimeNodeUuid(nodeUuid: string): Promise<any | null> {
        const cc = (globalThis as any)['cc'];
        const scene = cc?.director?.getScene?.();
        if (!scene) return null;
        const stack: any[] = [scene];
        while (stack.length) {
            const node = stack.pop();
            if (node?.uuid === nodeUuid) return node;
            for (const child of node?.children || []) stack.push(child);
        }
        return null;
    },

    async simulateButtonClick(nodeUuid: string): Promise<{ handlersFired: number, method: string }> {
        const cc = (globalThis as any)['cc'];
        const node = await methods.findRuntimeNodeUuid(nodeUuid);
        if (!node) {
            throw new Error(`Runtime node ${nodeUuid} not found in the live scene`);
        }
        const button = node.getComponent?.(cc.Button);
        if (!button) {
            throw new Error(`Node ${nodeUuid} has no cc.Button component`);
        }

        // Fire every editor-bound click handler (the same ones the UI would run).
        let handlersFired = 0;
        for (const ev of button.clickEvents || []) {
            try {
                ev.emit([button]);
                handlersFired++;
            } catch (e: any) {
                console.warn(`[simulateButtonClick] handler failed: ${e?.message || e}`);
            }
        }
        return { handlersFired, method: 'clickEvents' };
    },

    async bindButtonClickEvent(nodeUuid: string, componentType: string, handlerName: string, customEventData?: string): Promise<{ handlerCount: number }> {
        const cc = (globalThis as any)['cc'];
        const node = await methods.findRuntimeNodeUuid(nodeUuid);
        if (!node) {
            throw new Error(`Runtime node ${nodeUuid} not found in the live scene`);
        }
        const button = node.getComponent?.(cc.Button);
        if (!button) {
            throw new Error(`Node ${nodeUuid} has no cc.Button component`);
        }

        // Resolve the target component on the same node (or its children) by type name.
        const candidates = [
            node.getComponent?.(componentType),
            ...(node.getComponentsInChildren?.(componentType) || []),
        ].filter(Boolean);
        const target = candidates[0];
        if (!target) {
            throw new Error(`No component of type '${componentType}' found on node ${nodeUuid} or its children`);
        }
        if (typeof target[handlerName] !== 'function') {
            throw new Error(`Component '${componentType}' has no method '${handlerName}'`);
        }

        const handler = new cc.EventHandler();
        handler.target = target;
        handler.component = componentType;
        handler.handler = handlerName;
        handler.customEventData = customEventData || '';
        button.clickEvents = button.clickEvents || [];
        button.clickEvents.push(handler);
        return { handlerCount: button.clickEvents.length };
    },

    async runtimeGetState(): Promise<{ paused: boolean, timeScale: number, frameCount: number }> {
        const cc = (globalThis as any)['cc'];
        const game = cc?.game;
        const director = cc?.director;
        return {
            paused: game?.paused ?? false,
            timeScale: director?.getScheduler()?.getTimeScale?.() ?? 1,
            frameCount: director?.totalFrames ?? 0,
        };
    }
};
