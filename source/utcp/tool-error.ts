export interface ToolErrorOptions {
    code: string;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
    recovery?: string;
}

export interface ToolErrorResponse {
    status: number;
    body: {
        error: string;
        code: string;
        details?: Record<string, unknown>;
        recovery?: string;
    };
}

export class ToolError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: Record<string, unknown>;
    readonly recovery?: string;

    constructor({ code, message, status = 422, details, recovery }: ToolErrorOptions) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
        this.status = status;
        this.details = details;
        this.recovery = recovery;
    }
}

export function toToolErrorResponse(error: unknown): ToolErrorResponse {
    if (error instanceof ToolError) {
        return {
            status: error.status,
            body: {
                error: error.message,
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
                ...(error.recovery ? { recovery: error.recovery } : {}),
            },
        };
    }
    return {
        status: 500,
        body: { error: 'Internal tool error.', code: 'INTERNAL_ERROR' },
    };
}
