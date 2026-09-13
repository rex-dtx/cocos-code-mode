import { buildUiAccessibilityAudit, UiAccessibilityAuditRequest } from './ui-accessibility-audit';
import { buildUiLayoutReport, LayoutReportRequest } from './ui-layout-report';
import { buildUiSafeAreaInspect, UiSafeAreaInspectRequest } from './ui-safe-area-inspect';
import { buildUiLayoutValidate, UiLayoutValidateRequest } from './ui-layout-validate';
import { buildUiLayoutInspectGeometry, UiLayoutGeometryRequest, UiLayoutGeometryResult } from './ui-layout-inspect';

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
            console.warn('[cx3][scene] startCatchAll: fs unavailable in scene context');
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
                console.warn('[cx3][scene] captureScreenshot: Failed to modify camera:', e);
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
            } catch (e) { console.warn('[cx3][scene] Failed to repaintInEditMode:', e); }

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

    async animationUsageAnalyze(request: { nodeUuid?: string, maxNodes?: number } = {}): Promise<Record<string, unknown>> {
        const cc = (globalThis as any)['cc'];
        const root = request.nodeUuid ? await methods.findRuntimeNodeUuid(request.nodeUuid) : cc?.director?.getScene?.();
        if (!root) throw new Error('Animation usage analysis target scene or node was not found');
        const maxNodes = Number.isInteger(request.maxNodes) ? Math.max(1, Math.min(request.maxNodes!, 200)) : 100;
        const findings: Array<Record<string, unknown>> = [];
        const stack: any[] = [root];
        let visited = 0;
        while (stack.length && visited < maxNodes) {
            const node = stack.pop();
            visited++;
            const components = Array.isArray(node?.components) ? node.components : [];
            for (const component of components) {
                const className = String(component?.constructor?.name ?? component?._$erialized?.type ?? '');
                const isAnimation = className === 'Animation' || className === 'cc.Animation' || className === 'SkeletalAnimation' || className === 'cc.SkeletalAnimation';
                const isSpine = className === 'Skeleton' || className === 'sp.Skeleton';
                const isDragonBones = className === 'ArmatureDisplay' || className === 'dragonBones.ArmatureDisplay';
                if (!isAnimation && !isSpine && !isDragonBones) continue;
                const clips = Array.isArray(component.clips) ? component.clips.filter(Boolean).slice(0, 50).map((clip: any) => ({
                    uuid: clip?.uuid ?? null, name: clip?.name ?? null, duration: typeof clip?.duration === 'number' ? clip.duration : null,
                    sample: typeof clip?.sample === 'number' ? clip.sample : null,
                })) : [];
                const states = component._nameToState && typeof component._nameToState === 'object'
                    ? Object.keys(component._nameToState).slice(0, 50).map((name) => {
                        const state = component._nameToState[name];
                        return { name, playing: !!state?.isPlaying, paused: !!state?.isPaused, time: typeof state?.time === 'number' ? state.time : null, speed: typeof state?.speed === 'number' ? state.speed : null };
                    })
                    : [];
                const cacheMode = component.cacheMode ?? component.defaultCacheMode ?? component._cacheMode ?? null;
                findings.push({
                    nodeUuid: node?.uuid ?? null,
                    nodeName: node?.name ?? null,
                    component: className,
                    clipCount: clips.length,
                    clips,
                    defaultClip: component.defaultClip?.uuid ?? component.defaultClip?.name ?? null,
                    playOnLoad: typeof component.playOnLoad === 'boolean' ? component.playOnLoad : null,
                    stateCount: states.length,
                    states,
                    cacheMode,
                    cached: typeof component.isAnimationCached === 'function' ? !!component.isAnimationCached() : null,
                    recommendations: [
                        clips.length > 0 && !component.defaultClip ? 'Set a default clip or explicitly call play(name).' : null,
                        (isSpine || isDragonBones) && typeof component.isAnimationCached === 'function' && !component.isAnimationCached() ? 'Consider SHARED_CACHE or PRIVATE_CACHE for repeated deterministic playback; verify memory and dynamic-track tradeoffs.' : null,
                    ].filter(Boolean),
                });
            }
            for (const child of node?.children || []) stack.push(child);
        }
        return { nodeUuid: request.nodeUuid ?? root?.uuid ?? null, visitedNodes: visited, truncated: stack.length > 0, componentCount: findings.length, findings };
    },

    async animationRuntimeControl(request: {
        nodeUuid: string,
        operation: 'inspect' | 'play' | 'cross_fade' | 'pause' | 'resume' | 'stop' | 'set_default' | 'set_play_on_load' | 'set_state' | 'set_cache_mode' | 'invalidate_cache',
        clipName?: string,
        duration?: number,
        playOnLoad?: boolean,
        loop?: boolean,
        speed?: number,
        time?: number,
        repeatCount?: number,
        wrapMode?: number,
        cacheMode?: 'REALTIME' | 'SHARED_CACHE' | 'PRIVATE_CACHE',
    }): Promise<Record<string, unknown>> {
        const node = await methods.findRuntimeNodeUuid(request.nodeUuid);
        if (!node) throw new Error(`Runtime animation node ${request.nodeUuid} not found`);
        const components = Array.isArray(node.components) ? node.components : [];
        const animation = components.find((component: any) => ['Animation', 'cc.Animation', 'SkeletalAnimation', 'cc.SkeletalAnimation'].includes(String(component?.constructor?.name ?? '')));
        const spine = components.find((component: any) => ['Skeleton', 'sp.Skeleton'].includes(String(component?.constructor?.name ?? '')));
        const dragonBones = components.find((component: any) => ['ArmatureDisplay', 'dragonBones.ArmatureDisplay'].includes(String(component?.constructor?.name ?? '')));
        const describe = (component: any): Record<string, unknown> => {
            const clips = Array.isArray(component?.clips) ? component.clips.filter(Boolean).slice(0, 50) : [];
            const states = typeof component?.getState === 'function'
                ? clips.map((clip: any) => {
                    const state = component.getState(clip?.name ?? clip?.uuid);
                    return state ? {
                        name: state.name ?? clip?.name ?? clip?.uuid ?? null,
                        isPlaying: typeof state.isPlaying === 'boolean' ? state.isPlaying : null,
                        isPaused: typeof state.isPaused === 'boolean' ? state.isPaused : null,
                        speed: typeof state.speed === 'number' ? state.speed : null,
                        time: typeof state.time === 'number' ? state.time : null,
                        repeatCount: typeof state.repeatCount === 'number' ? state.repeatCount : null,
                        wrapMode: typeof state.wrapMode === 'number' ? state.wrapMode : null,
                    } : null;
                }).filter(Boolean)
                : [];
            return {
                component: component?.constructor?.name ?? null,
                clips: clips.map((clip: any) => ({ uuid: clip?.uuid ?? null, name: clip?.name ?? null, duration: clip?.duration ?? null })),
                states,
                defaultClip: component?.defaultClip?.uuid ?? component?.defaultClip?.name ?? null,
                playOnLoad: typeof component?.playOnLoad === 'boolean' ? component.playOnLoad : null,
                cacheMode: component?.cacheMode ?? component?.defaultCacheMode ?? component?._cacheMode ?? null,
                cached: typeof component?.isAnimationCached === 'function' ? !!component.isAnimationCached() : null,
            };
        };
        if (request.operation === 'inspect') return { nodeUuid: request.nodeUuid, animation: animation ? describe(animation) : null, spine: spine ? describe(spine) : null, dragonBones: dragonBones ? describe(dragonBones) : null };
        if (animation) {
            const name = request.clipName;
            if (request.operation === 'play') animation.play(name);
            else if (request.operation === 'cross_fade') {
                if (!name) throw new Error('cross_fade requires clipName');
                animation.crossFade(name, request.duration ?? 0.3);
            } else if (request.operation === 'pause') animation.pause();
            else if (request.operation === 'resume') animation.resume();
            else if (request.operation === 'stop') animation.stop();
            else if (request.operation === 'set_default') {
                if (!name) throw new Error('set_default requires clipName');
                const clip = (animation.clips || []).find((candidate: any) => candidate?.name === name || candidate?.uuid === name);
                if (!clip) throw new Error(`Animation clip '${name}' was not found`);
                animation.defaultClip = clip;
            } else if (request.operation === 'set_play_on_load') {
                if (typeof request.playOnLoad !== 'boolean') throw new Error('set_play_on_load requires playOnLoad');
                animation.playOnLoad = request.playOnLoad;
            } else if (request.operation === 'set_state') {
                if (!name) throw new Error('set_state requires clipName');
                const state = animation.getState(name);
                if (!state) throw new Error(`Animation state '${name}' was not found`);
                if (request.speed !== undefined) state.speed = request.speed;
                if (request.time !== undefined) state.time = request.time;
                if (request.repeatCount !== undefined) state.repeatCount = request.repeatCount;
                if (request.wrapMode !== undefined) state.wrapMode = request.wrapMode;
            } else if (request.operation !== 'set_cache_mode' && request.operation !== 'invalidate_cache') {
                throw new Error(`Unsupported animation operation '${request.operation}'`);
            }
        }
        if (!animation && request.operation !== 'set_cache_mode' && request.operation !== 'invalidate_cache') {
            const name = request.clipName;
            const skeletalTarget = spine || dragonBones;
            if (!skeletalTarget) throw new Error('No Animation, SkeletalAnimation, Spine, or DragonBones component found');
            if (request.operation === 'play') {
                if (!name) throw new Error('play requires clipName for Spine or DragonBones');
                if (spine && typeof spine.setAnimation === 'function') spine.setAnimation(0, name, request.loop ?? false);
                else if (dragonBones && typeof dragonBones.playAnimation === 'function') dragonBones.playAnimation(name, request.loop ? 0 : 1);
                else throw new Error('Skeletal playback API is unavailable');
            } else if (request.operation === 'pause') {
                if (spine) spine.paused = true;
                else dragonBones.timeScale = 0;
            } else if (request.operation === 'resume') {
                if (spine) spine.paused = false;
                else dragonBones.timeScale = 1;
            } else if (request.operation === 'stop') {
                if (spine && typeof spine.clearTracks === 'function') spine.clearTracks();
                else {
                    const armature = dragonBones?.armature?.();
                    if (typeof armature?.animation?.stop === 'function') armature.animation.stop();
                    else throw new Error('Skeletal stop API is unavailable');
                }
            } else {
                throw new Error(`Operation '${request.operation}' requires an Animation or SkeletalAnimation component`);
            }
        }
        const cacheTarget = spine || dragonBones;
        if (request.operation === 'set_cache_mode' || request.operation === 'invalidate_cache') {
            if (!cacheTarget) throw new Error('No Spine or DragonBones animation component found for cache operation');
            if (request.operation === 'set_cache_mode') {
                if (!request.cacheMode) throw new Error('set_cache_mode requires cacheMode');
                const enumObject = cacheTarget.constructor?.AnimationCacheMode
                    ?? (globalThis as any).sp?.Skeleton?.AnimationCacheMode
                    ?? (globalThis as any).dragonBones?.ArmatureDisplay?.AnimationCacheMode;
                const fallbackModes = { REALTIME: 0, SHARED_CACHE: 1, PRIVATE_CACHE: 2 } as const;
                const enumValue = enumObject?.[request.cacheMode];
                const mode = typeof enumValue === 'number' ? enumValue : fallbackModes[request.cacheMode];
                if (typeof cacheTarget.setAnimationCacheMode !== 'function') throw new Error('Animation cache mode is unavailable on this component');
                cacheTarget.setAnimationCacheMode(mode);
                const readBack = cacheTarget.cacheMode ?? cacheTarget.defaultCacheMode ?? cacheTarget._cacheMode;
                if (readBack !== mode) throw new Error(`Animation cache mode read-back mismatch: expected ${mode}, got ${String(readBack)}`);
            } else {
                if (typeof cacheTarget.invalidAnimationCache !== 'function') throw new Error('Animation cache invalidation is unavailable on this component');
                cacheTarget.invalidAnimationCache();
            }
        }
        return { nodeUuid: request.nodeUuid, operation: request.operation, animation: animation ? describe(animation) : null, spine: spine ? describe(spine) : null, dragonBones: dragonBones ? describe(dragonBones) : null };
    },

    async uiLayoutInspectGeometry(request: UiLayoutGeometryRequest): Promise<UiLayoutGeometryResult> {
        const cc = (globalThis as { cc?: { director?: { getScene?: () => unknown } } }).cc;
        const scene = cc?.director?.getScene?.();
        if (!scene || typeof scene !== 'object') {
            return { error: { code: 'UI_LAYOUT_SCENE_UNAVAILABLE', message: 'Live scene graph is unavailable.' } };
        }
        return buildUiLayoutInspectGeometry(scene, request);
    },

    async uiLayoutReport(request: LayoutReportRequest): Promise<unknown> {
        const cc = (globalThis as { cc?: { director?: { getScene?: () => unknown } } }).cc;
        const scene = cc?.director?.getScene?.();
        if (!scene || typeof scene !== 'object') {
            return { error: { code: 'UI_LAYOUT_SCENE_UNAVAILABLE', message: 'Live scene graph is unavailable', evidence: {} } };
        }
        return buildUiLayoutReport(scene as Parameters<typeof buildUiLayoutReport>[0], request);
    },

    async uiAccessibilityAudit(request: UiAccessibilityAuditRequest): Promise<unknown> {
        const cc = (globalThis as { cc?: { director?: { getScene?: () => unknown } } }).cc;
        const scene = cc?.director?.getScene?.();
        if (!scene || typeof scene !== 'object') {
            return { error: { code: 'UI_ACCESSIBILITY_SCENE_UNAVAILABLE', message: 'Live scene graph is unavailable', evidence: {} } };
        }
        return buildUiAccessibilityAudit(scene as Parameters<typeof buildUiAccessibilityAudit>[0], request);
    },

    async uiSafeAreaInspect(request: UiSafeAreaInspectRequest): Promise<unknown> {
        const cc = (globalThis as { cc?: { director?: { getScene?: () => unknown } } }).cc;
        const scene = cc?.director?.getScene?.();
        if (!scene || typeof scene !== 'object') {
            return { error: { code: 'UI_SAFE_AREA_SCENE_UNAVAILABLE', message: 'Live scene graph is unavailable', evidence: {} } };
        }
        return buildUiSafeAreaInspect(scene as Parameters<typeof buildUiSafeAreaInspect>[0], request);
    },
    async uiLayoutValidate(request: UiLayoutValidateRequest): Promise<unknown> {
        const cc = (globalThis as { cc?: { director?: { getScene?: () => unknown } } }).cc;
        const scene = cc?.director?.getScene?.();
        if (!scene || typeof scene !== 'object') {
            return { error: { code: 'UI_LAYOUT_VALIDATE_SCENE_UNAVAILABLE', message: 'Live scene graph is unavailable', evidence: {} } };
        }
        return buildUiLayoutValidate(scene as Parameters<typeof buildUiLayoutValidate>[0], request);
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
                console.warn(`[cx3][scene] simulateButtonClick handler failed: ${e?.message || e}`);
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

        const handler = new cc.Component.EventHandler();
        handler.target = target;
        handler.component = componentType;
        handler.handler = handlerName;
        handler.customEventData = customEventData || '';
        button.clickEvents = button.clickEvents || [];
        button.clickEvents.push(handler);
        return { handlerCount: button.clickEvents.length };
    },

    async runtimeGetState(): Promise<{ running: boolean, paused: boolean, timeScale: number, frameCount: number }> {
        const cc = (globalThis as any)['cc'];
        const game = cc?.game;
        const scheduler = cc?.director?.getScheduler?.();
        const director = cc?.director;
        const timeScale = scheduler?.getTimeScale?.();
        const frameCount = typeof director?.totalFrames === 'number' ? director.totalFrames : director?.getTotalFrames?.();
        const paused = typeof game?.paused === 'boolean' ? game.paused : Boolean(game?.isPaused?.());
        if (!game || typeof paused !== 'boolean' || typeof timeScale !== 'number' || !Number.isFinite(timeScale) || typeof frameCount !== 'number' || !Number.isFinite(frameCount)) {
            throw new Error('Runtime preview state is unavailable');
        }
        return {
            // Creator 3.7 omits game.isPlaying from the editor scene context;
            // absence therefore means preview readiness is unverified.
            running: typeof game.isPlaying === 'boolean' ? game.isPlaying : false,
            paused,
            timeScale,
            frameCount,
        };
    },
    async inspectLocalization(): Promise<{ supported: boolean, currentLanguage: string | null, languages: string[], directions: Record<string, string>, error?: string }> {
        try {
            const mod = require('db://localization-editor/l10n');
            const l10n = mod.l10n;
            const languages = Array.from(l10n.languages ?? []) as string[];
            const directions: Record<string, string> = {};
            for (const language of languages.slice(0, 32)) directions[language] = String(l10n.direction(language));
            return { supported: true, currentLanguage: l10n.currentLanguage ?? null, languages, directions };
        } catch (error: any) {
            return { supported: false, currentLanguage: null, languages: [], directions: {}, error: String(error?.message ?? error) };
        }
    },
    async validateLocalization(keys: string[]): Promise<{ supported: boolean, language: string | null, checkedKeys: number, missingKeys: string[], error?: string }> {
        try {
            const mod = require('db://localization-editor/l10n');
            const l10n = mod.l10n;
            const boundedKeys = Array.from(new Set((keys ?? []).filter((key): key is string => typeof key === 'string' && key.length > 0))).slice(0, 256);
            const missingKeys = boundedKeys.filter((key) => !l10n.exists(key));
            return { supported: true, language: l10n.currentLanguage ?? null, checkedKeys: boundedKeys.length, missingKeys };
        } catch (error: any) {
            return { supported: false, language: null, checkedKeys: 0, missingKeys: [], error: String(error?.message ?? error) };
        }
    },
};
