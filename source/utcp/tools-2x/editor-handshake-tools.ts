import { isAbsolute, normalize } from 'path';
import { getBuildInfo } from '../../build-info';
import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { sceneScript } from '../utils/ipc-promise';

type Probe = { status: 'responsive' | 'timeout' | 'error' | 'invalid-response'; sceneReady: boolean | null };

export class EditorHandshakeTools {
    constructor(private readonly instanceId: string) {}

    @utcpTool('editorHandshake', 'Read-only Creator 2.x handshake. Compare expectedProjectPath and bind the returned instanceId before mutations; re-handshake after restart. Probe the existing scene-info script route, not unsupported scene:query-is-ready IPC.', {
        type: 'object', properties: {
            expectedProjectPath: { type: 'string', minLength: 1, maxLength: 4096 },
            timeoutMs: { type: 'integer', minimum: 1, maximum: 5000 },
        },
    }, {
        type: 'object', properties: {
            instanceId: { type: 'string' }, projectPath: { type: ['string', 'null'] },
            projectMatches: { type: ['boolean', 'null'] }, editorVersion: { type: ['string', 'null'] },
            build: { type: 'object' }, probe: { type: 'object' }, capturedAt: { type: 'integer' },
        }, required: ['instanceId', 'projectPath', 'projectMatches', 'editorVersion', 'build', 'probe', 'capturedAt'],
    }, 'GET', ['editor', 'handshake', 'connection', 'health'])
    async editorHandshake(args: { expectedProjectPath?: string; timeoutMs?: number } = {}) {
        const expected = args.expectedProjectPath;
        if (expected !== undefined && (typeof expected !== 'string' || !isAbsolute(expected) || expected.length > 4096)) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'expectedProjectPath must be an absolute project path.' });
        }
        const timeoutMs = args.timeoutMs === undefined ? 1000 : args.timeoutMs;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) {
            throw new ToolError({ code: 'INVALID_ARGUMENT', status: 400, message: 'timeoutMs must be between 1 and 5000.' });
        }
        const projectPath = typeof Editor.Project?.path === 'string' && Editor.Project.path ? Editor.Project.path : null;
        const norm = (value: string) => {
            const result = normalize(value).replace(/[\\/]+$/, '');
            return process.platform === 'win32' ? result.toLowerCase() : result;
        };
        const matches = expected === undefined || projectPath === null ? null : norm(expected) === norm(projectPath);
        if (expected !== undefined && matches !== true) {
            throw new ToolError({ code: 'PROJECT_MISMATCH', status: 409, message: 'Handshake project identity could not be verified against expectedProjectPath.' });
        }
        let timer: NodeJS.Timeout | undefined;
        const request = sceneScript<unknown>('scene-info').then((value): Probe => value && typeof value === 'object'
            ? { status: 'responsive', sceneReady: true } : { status: 'invalid-response', sceneReady: null },
        (error): Probe => /no scene open/i.test(String(error?.message ?? error))
            ? { status: 'responsive', sceneReady: false } : { status: 'error', sceneReady: null });
        const probe = await Promise.race([request, new Promise<Probe>(resolve => {
            timer = setTimeout(() => resolve({ status: 'timeout', sceneReady: null }), timeoutMs);
        })]);
        clearTimeout(timer);
        const versions = Editor.versions;
        const version = versions && (versions['CocosCreator'] || versions['cocos-creator'] || versions['editor']);
        return {
            instanceId: this.instanceId, projectPath, projectMatches: matches,
            editorVersion: typeof version === 'string' ? version : null,
            build: getBuildInfo(), probe, capturedAt: Date.now(),
        };
    }
}
