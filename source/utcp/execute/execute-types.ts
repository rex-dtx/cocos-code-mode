// execute-types — contracts for the pluggable execute pipeline.
//
// The eval core is a few lines; every policy (safety, allowlist, logging, result
// coercion) lives in an ExecuteGuard so new logic is a registerExecuteGuard() call,
// never a core edit.

export type ExecuteContextKind = 'scene' | 'editor';

export interface ExecuteContext {
    context: ExecuteContextKind;
    code: string;
    args?: Record<string, any>;
    projectPath: string;
    // Guards can read/write extra metadata — e.g. safetyChecks=false to skip the
    // safety guard for one call.
    [key: string]: any;
}

export interface ExecuteGuard {
    name: string;
    // Return a (possibly mutated) context, or throw to reject the request.
    before?(ctx: ExecuteContext): ExecuteContext | void | Promise<ExecuteContext | void>;
    // Observe/transform the result after execution.
    after?(ctx: ExecuteContext, result: any): any | Promise<any>;
}
