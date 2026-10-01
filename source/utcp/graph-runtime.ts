import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { ToolError } from './tool-error';

export type GraphOperation = 'status' | 'build' | 'query' | 'resolve' | 'navigate' | 'refs' | 'validate';
export interface GraphOperationInput {
    project: string;
    outDir: string;
    [key: string]: unknown;
}

function contained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolveProjectGraphCache(projectPath: unknown): { project: string; outDir: string } {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
        throw new ToolError({ code: 'GRAPH_PATH_INVALID', status: 400, message: 'The active Creator project path is unavailable or not absolute.' });
    }
    try {
        const project = fs.realpathSync(projectPath);
        if (!fs.statSync(project).isDirectory()) throw new Error('Project root is not a directory.');
        const root = path.join(project, '.cocos-graph');
        if (!fs.existsSync(root)) fs.mkdirSync(root);
        const realRoot = fs.realpathSync(root);
        if (!contained(project, realRoot) || path.relative(project, realRoot) !== '.cocos-graph' || !fs.statSync(realRoot).isDirectory()) throw new Error('Graph cache root escapes the project.');
        const namespace = path.join(realRoot, 'cocos-pilot');
        if (!fs.existsSync(namespace)) fs.mkdirSync(namespace);
        const outDir = fs.realpathSync(namespace);
        if (!contained(project, outDir) || !contained(realRoot, outDir) || path.relative(project, outDir) !== path.join('.cocos-graph', 'cocos-pilot') || !fs.statSync(outDir).isDirectory()) throw new Error('Graph cache namespace escapes the project.');
        return { project, outDir };
    } catch (error) {
        throw new ToolError({ code: 'GRAPH_PATH_INVALID', status: 400, message: 'The project graph cache path is invalid or outside the active Creator project.', details: { cause: error instanceof Error ? error.message : String(error) } });
    }
}

export function runGraphWorker(operation: GraphOperation, input: GraphOperationInput): Promise<Record<string, unknown>> {
    const workerPath = path.resolve(__dirname, '../../tools/cocos-graph/runtime-worker.mjs');
    if (!fs.existsSync(workerPath)) {
        throw new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 500, message: 'The packaged Cocos Graph worker is missing.', recovery: 'Reinstall the extension including tools/cocos-graph.' });
    }
    const deadline = operation === 'build' ? 300_000 : 60_000;
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let worker: Worker;
        const finish = (error?: Error, result?: Record<string, unknown>) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.removeAllListeners();
            void worker.terminate().catch(() => undefined);
            if (error) reject(error);
            else resolve(result!);
        };
        try {
            worker = new Worker(workerPath, { workerData: { operation, input } });
        } catch (error) {
            reject(new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 502, message: 'Cocos Graph worker could not start.', details: { cause: error instanceof Error ? error.message : String(error) } }));
            return;
        }
        timer = setTimeout(() => finish(new ToolError({ code: operation === 'build' ? 'GRAPH_BUILD_TIMEOUT' : 'GRAPH_OPERATION_TIMEOUT', status: 504, message: `Cocos Graph ${operation} exceeded its worker deadline.` })), deadline);
        worker.once('message', (message: unknown) => {
            if (!message || typeof message !== 'object' || !('ok' in message) || typeof message.ok !== 'boolean') {
                finish(new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 502, message: 'Cocos Graph worker returned an invalid response.' }));
                return;
            }
            if (message.ok) {
                if ('result' in message && message.result && typeof message.result === 'object' && !Array.isArray(message.result)) finish(undefined, message.result as Record<string, unknown>);
                else finish(new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 502, message: 'Cocos Graph worker returned an invalid result.' }));
                return;
            }
            const reportedCode = 'code' in message && typeof message.code === 'string' ? message.code : '';
            const code = ['GRAPH_NOT_BUILT', 'GRAPH_PATH_INVALID', 'GRAPH_CACHE_CORRUPT', 'GRAPH_SCHEMA_UNSUPPORTED', 'GRAPH_BUILD_FAILED'].includes(reportedCode) ? reportedCode : 'GRAPH_BUILD_FAILED';
            finish(new ToolError({
                code, status: code === 'GRAPH_NOT_BUILT' ? 422 : code === 'GRAPH_PATH_INVALID' ? 400 : 502,
                message: 'error' in message && typeof message.error === 'string' ? message.error : `Cocos Graph ${operation} failed.`,
                recovery: code === 'GRAPH_NOT_BUILT' ? 'Call graphManage with operation=build and the same bundle.' : 'Inspect the active project and cache; rebuild explicitly if needed.',
            }));
        });
        worker.once('error', (error) => finish(new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 502, message: 'Cocos Graph worker failed.', details: { cause: error.message } })));
        worker.once('exit', (code) => {
            if (!settled) finish(new ToolError({ code: 'GRAPH_BUILD_FAILED', status: 502, message: `Cocos Graph worker exited with code ${code} before responding.` }));
        });
    });
}
