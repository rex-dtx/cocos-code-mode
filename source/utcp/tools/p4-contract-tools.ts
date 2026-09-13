import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { ProjectTools } from './project-tools';
import { RuntimeSessionTools } from './runtime-session-tools';

const projectTools = new ProjectTools();
const runtimeTools = new RuntimeSessionTools();

function requireText(value: unknown, name: string, max = 256): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
        throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: `${name} must be a non-empty string of at most ${max} characters.` });
    }
    return value;
}

export class P4ContractTools {
    @utcpTool('physics2dConfigure', 'Configure 2D physics project settings only when Creator exposes a verified project settings writer.', {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string', minLength: 1, maxLength: 256 }, value: {} },
        required: ['path', 'value'],
    }, { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] }, 'POST', ['physics', '2d', 'configure'])
    async physics2dConfigure(args: { path?: string, value?: unknown }): Promise<{ success: boolean }> {
        const path = requireText(args?.path, 'path');
        return projectTools.projectSetConfig({ path, value: args?.value });
    }

    @utcpTool('physics3dConfigure', 'Configure 3D physics project settings only when Creator exposes a verified project settings writer.', {
        type: 'object', additionalProperties: false,
        properties: { path: { type: 'string', minLength: 1, maxLength: 256 }, value: {} },
        required: ['path', 'value'],
    }, { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] }, 'POST', ['physics', '3d', 'configure'])
    async physics3dConfigure(args: { path?: string, value?: unknown }): Promise<{ success: boolean }> {
        const path = requireText(args?.path, 'path');
        return projectTools.projectSetConfig({ path, value: args?.value });
    }

    @utcpTool('particlePlayback', 'Control a named runtime particle target only through a verified runtime session; never claims editor-scene playback success.', {
        type: 'object', additionalProperties: false,
        properties: {
            sessionId: { type: 'string', minLength: 1, maxLength: 64 },
            operation: { type: 'string', enum: ['play', 'stop', 'clear'] },
            nodeReference: {
                type: 'object',
                additionalProperties: false,
                properties: { id: { type: 'string', minLength: 1, maxLength: 256 } },
                required: ['id'],
            },
        },
        required: ['sessionId', 'operation', 'nodeReference'],
    }, { type: 'object', properties: { success: { type: 'boolean' } }, required: ['success'] }, 'POST', ['particle', 'playback', 'runtime'])
    async particlePlayback(args: { sessionId?: string, operation?: string, nodeReference?: { id?: string } }): Promise<never> {
        const sessionId = requireText(args?.sessionId, 'sessionId', 64);
        if (!args?.nodeReference?.id) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'nodeReference.id is required.' });
        }
        await runtimeTools.runtimeSessionLifecycle({ operation: 'inspect', sessionId });
        throw new ToolError({ code: 'RUNTIME_NOT_READY', status: 409, message: `Particle playback transport is not verified for runtime session ${sessionId}.`, recovery: 'Start a verified game-view runtime session before retrying.' });
    }
}
