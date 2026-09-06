import { utcpTool } from '../decorators';
import { sceneIpc, sceneScript } from '../utils/ipc-promise';
import { ToolError } from '../tool-error';
import { DiagnosticsTools } from './diagnostics-tools';
import { RuntimeTools } from './runtime-tools';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export class ValidationTools {

    @utcpTool(
        'getPerformanceSnapshot',
        'Get scene scale counters: node/component counts, UI counts, depth, warnings.',
        { type: 'object', properties: {} },
        {
            type: 'object',
            properties: {
                nodeCount: { type: 'number' },
                componentCount: { type: 'number' },
                uiNodeCount: { type: 'number' },
                maxDepth: { type: 'number' },
                activeNodes: { type: 'number' },
                warnings: { type: 'array', items: { type: 'string' } },
            },
            required: ['nodeCount', 'componentCount'],
        },
        'GET',
        ['performance', 'snapshot', 'scene', 'count', 'health', 'memory']
    )
    async getPerformanceSnapshot(): Promise<{ nodeCount: number, componentCount: number, uiNodeCount: number, maxDepth: number, activeNodes: number, warnings: string[] }> {
        const result = await sceneScript<any>('scene-perf');
        if (!result || typeof result.nodeCount !== 'number') {
            throw new ToolError({
                code: 'SCENE_EMPTY',
                status: 404,
                message: 'No scene open or failed to query scene tree',
                recovery: 'Open a scene with sceneOpen, then retry.',
            });
        }
        const warnings: string[] = Array.isArray(result.warnings) ? result.warnings.slice() : [];
        if (result.nodeCount > 500) warnings.push(`High node count: ${result.nodeCount} nodes may impact performance`);
        if (result.maxDepth > 15) warnings.push(`Deep hierarchy: depth ${result.maxDepth} may cause layout issues`);
        if (result.componentCount > result.nodeCount * 3) warnings.push(`High component density: ${result.componentCount} components on ${result.nodeCount} nodes`);
        return {
            nodeCount: result.nodeCount,
            componentCount: result.componentCount,
            uiNodeCount: result.uiNodeCount || 0,
            maxDepth: result.maxDepth || 0,
            activeNodes: result.activeNodes || 0,
            warnings,
        };
    }

    @utcpTool(
        'validateScene',
        'Compact validation pass: scene info + runtime state + optional TypeScript diagnostics + recent log errors.',
        {
            type: 'object',
            properties: {
                includeScriptDiagnostics: { type: 'boolean', description: 'Run TypeScript diagnostics (default true)' },
                includeLogErrors: { type: 'boolean', description: 'Check recent editor logs for errors (default true)' },
            },
        },
        {
            type: 'object',
            properties: {
                ok: { type: 'boolean' },
                scene: { type: 'object' },
                runtime: { type: 'object' },
                performance: { type: 'object' },
                diagnostics: { type: 'object' },
                logErrors: { type: 'array', items: { type: 'string' } },
            },
            required: ['ok'],
        },
        'POST',
        ['validate', 'scene', 'health', 'check', 'diagnostics', 'runtime']
    )
    async validateScene(args: { includeScriptDiagnostics?: boolean, includeLogErrors?: boolean } = {}): Promise<{
        ok: boolean,
        scene: any,
        runtime: any,
        performance: any,
        diagnostics: any,
        logErrors: string[],
    }> {
        const includeDiag = args.includeScriptDiagnostics !== false;
        const includeLogs = args.includeLogErrors !== false;

        const probeScene = async () => {
            try {
                const raw = await sceneIpc<any>('scene:query-hierarchy');
                const [sceneId, hierarchy] = Array.isArray(raw) ? raw : [undefined, raw];
                const roots = Array.isArray(hierarchy) ? hierarchy : hierarchy ? [hierarchy] : [];
                const visible = roots.filter((n: any) => n && n.hidden !== true);
                return { uuid: sceneId || null, childCount: visible.length, name: visible[0] && visible[0].name };
            } catch (e: any) { return { error: e.message }; }
        };
        const probeRuntime = async () => {
            try { return await new RuntimeTools().runtimeGetState(); } catch (e: any) { return { error: e.message }; }
        };
        const probePerf = async () => {
            try { return await this.getPerformanceSnapshot(); } catch (e: any) { return { error: e.message }; }
        };
        const probeDiag = async () => {
            if (!includeDiag) return null;
            try {
                const result = await new DiagnosticsTools().runScriptDiagnostics({});
                return { ok: result.ok, errorCount: result.errorCount };
            } catch (e: any) { return { error: e.message }; }
        };
        const probeLogs = async (): Promise<string[]> => {
            if (!includeLogs) return [];
            try {
                const projectPath = (Editor.Project as any)?.path;
                if (!projectPath) return [];
                const logFile = join(projectPath, 'temp', 'logs', 'project.log');
                if (!existsSync(logFile)) return [];
                const lines = readFileSync(logFile, 'utf8').split(/\r?\n/);
                return lines.filter((l) => /error/i.test(l)).slice(-5);
            } catch { return []; }
        };

        const [scene, runtime, performance, diagnostics, logErrors] = await Promise.all([
            probeScene(), probeRuntime(), probePerf(), probeDiag(), probeLogs(),
        ]);
        const diag = diagnostics as any;
        const diagOk = diag == null ? true : (diag.ok === true && !diag.error);
        const ok = !(scene as any).error && !(runtime as any).error && !(performance as any).error
            && diagOk
            && logErrors.length === 0;
        return { ok, scene, runtime, performance, diagnostics, logErrors };
    }
}
