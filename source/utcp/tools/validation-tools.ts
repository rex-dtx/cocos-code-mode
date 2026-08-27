import { utcpTool } from '../decorators';
import { DEFAULT_TREE_MAX_DEPTH, DEFAULT_TREE_MAX_NODES } from '../utils/tools-utils';

// Performance snapshot + scene validation. Walks the scene tree to count
// nodes/components, and merges with runtime state + diagnostics + logs.

export class ValidationTools {

    @utcpTool(
        'getPerformanceSnapshot',
        'Get scene scale and performance counters: node/component counts, UI counts, depth, memory warnings.',
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
        const tree = await Editor.Message.request('scene', 'query-node-tree') as any;
        if (!tree) {
            throw new Error('No scene open or failed to query scene tree');
        }

        let nodeCount = 0;
        let componentCount = 0;
        let uiNodeCount = 0;
        let activeNodes = 0;
        let maxDepth = 0;
        const warnings: string[] = [];

        const walk = (node: any, depth: number) => {
            nodeCount++;
            if (depth > maxDepth) maxDepth = depth;
            if (node.active !== false) activeNodes++;

            // Count components
            const comps = node.__comps__ || node.components || [];
            componentCount += Array.isArray(comps) ? comps.length : 0;

            // Detect UI nodes (have UITransform or are Canvas children)
            if (node.layer === 33554432) { // UI_2D layer
                uiNodeCount++;
            }

            const children = node.children || [];
            for (const child of children) {
                walk(child, depth + 1);
            }
        };

        walk(tree, 0);

        // Warnings for common performance issues
        if (nodeCount > 500) warnings.push(`High node count: ${nodeCount} nodes may impact performance`);
        if (maxDepth > 15) warnings.push(`Deep hierarchy: depth ${maxDepth} may cause layout issues`);
        if (componentCount > nodeCount * 3) warnings.push(`High component density: ${componentCount} components on ${nodeCount} nodes`);

        return { nodeCount, componentCount, uiNodeCount, maxDepth, activeNodes, warnings };
    }

    @utcpTool(
        'validateScene',
        'Run a compact validation pass: scene info + runtime state + TypeScript diagnostics + recent errors. Returns ok/fail with details.',
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
    async validateScene(args: { includeScriptDiagnostics?: boolean, includeLogErrors?: boolean }): Promise<{
        ok: boolean,
        scene: any,
        runtime: any,
        performance: any,
        diagnostics: any,
        logErrors: string[],
    }> {
        const includeDiag = args.includeScriptDiagnostics !== false;
        const includeLogs = args.includeLogErrors !== false;

        // Scene info
        let scene: any = { error: 'No scene open' };
        try {
            const tree = await Editor.Message.request('scene', 'query-node-tree');
            if (tree) {
                scene = { uuid: tree.uuid, name: tree.name, childCount: (tree.children || []).length };
            }
        } catch (e: any) {
            scene = { error: e.message };
        }

        // Runtime state
        let runtime: any = { paused: false, timeScale: 1 };
        try {
            const state = await Editor.Message.request('scene', 'execute-scene-script', {
                name: 'cc-bridge-3x', method: 'runtimeGetState', args: [],
            });
            runtime = state || runtime;
        } catch (e: any) {
            runtime = { error: e.message };
        }

        // Performance snapshot
        let performance: any = {};
        try {
            performance = await this.getPerformanceSnapshot();
        } catch (e: any) {
            performance = { error: e.message };
        }

        // Diagnostics
        let diagnostics: any = null;
        if (includeDiag) {
            try {
                const { DiagnosticsTools } = await import('./diagnostics-tools');
                const diagTool = new DiagnosticsTools();
                const result = await diagTool.runScriptDiagnostics({});
                diagnostics = { ok: result.ok, errorCount: result.errorCount };
            } catch (e: any) {
                diagnostics = { error: e.message };
            }
        }

        // Log errors
        let logErrors: string[] = [];
        if (includeLogs) {
            try {
                const logs = await Editor.Message.request('console', 'query-logs', { level: 'error', limit: 10 }) as any[];
                if (Array.isArray(logs)) {
                    logErrors = logs.map(l => l.message || String(l)).slice(0, 5);
                }
            } catch (e: any) {
                // Console query may not be available
            }
        }

        const ok = !scene.error && !runtime.error && !performance.error
            && (!diagnostics || diagnostics.ok !== false)
            && logErrors.length === 0;

        return { ok, scene, runtime, performance, diagnostics, logErrors };
    }
}
