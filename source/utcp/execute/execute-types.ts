export type ExecuteContextKind = 'scene' | 'editor';

export interface ExecuteContext {
    context: ExecuteContextKind;
    code: string;
    args?: Record<string, unknown>;
    projectPath: string;
    [key: string]: unknown;
}

export interface ExecuteGuard {
    name: string;
    before?(ctx: ExecuteContext): ExecuteContext | void | Promise<ExecuteContext | void>;
    after?(ctx: ExecuteContext, result: unknown): unknown | Promise<unknown>;
}
