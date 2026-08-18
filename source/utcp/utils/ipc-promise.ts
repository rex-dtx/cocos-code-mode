// Callback->Promise cho API editor 2.x (callback-last, (err, result)).
// ponytail: 3 helper cho ca codebase, khong wrap tung method.

function toError(err: any): Error {
    return err instanceof Error ? err : new Error(String(err));
}

/** assetdb callback-style: fn(cb) */
export function cbToPromise<T>(fn: (cb: (err: any, result: T) => void) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        fn((err, result) => (err ? reject(toError(err)) : resolve(result)));
    });
}

/** Editor.Ipc.sendToPanel(panel, msg, ...args, cb) — cb nhan (err, ...results) */
export function panelIpc<T>(panel: string, message: string, ...args: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        Editor.Ipc.sendToPanel(panel, message, ...args, (err: any, ...results: any[]) => {
            if (err) { return reject(toError(err)); }
            resolve((results.length > 1 ? results : results[0]) as T);
        });
    });
}

/** panelIpc chot cung panel 'scene' — dung cho moi message scene:*. */
export function sceneIpc<T>(message: string, ...args: any[]): Promise<T> {
    return panelIpc<T>('scene', message, ...args);
}

/** Editor.Scene.callSceneScript(pkg, msg, ...args, cb) */
export function sceneScript<T>(message: string, ...args: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        Editor.Scene.callSceneScript('cocos-code-mode-2x', message, ...args, (err: any, result: T) => {
            if (err) { return reject(toError(err)); }
            resolve(result);
        });
    });
}
