import { utcpTool } from '../decorators';
import { ToolError } from '../tool-error';
import { SessionPresenceStore, SessionPresenceInput, SessionPresenceError } from '../session-presence';
import type { JsonSchema } from '@utcp/sdk';

const snapshotSchema: JsonSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        sessionId: { type: 'string' }, label: { type: ['string', 'null'] },
        transport: { type: 'string', enum: ['http-helper', 'code-mode'] },
        lastSeen: { type: 'integer' }, ageMs: { type: 'integer' },
        status: { type: 'string', enum: ['Active', 'Stale', 'Expired'] },
    }, required: ['sessionId', 'label', 'transport', 'lastSeen', 'ageMs', 'status'],
};

export class SessionTools {
    constructor(private readonly store: SessionPresenceStore) {}

    @utcpTool('editorSessionHeartbeat', 'Record an explicitly caller-declared editor session heartbeat. This is presence only and does not authenticate the caller or prove that a chat/model is alive.', {
        type: 'object', additionalProperties: false,
        properties: {
            sessionId: { type: 'string', minLength: 1, maxLength: 128 },
            label: { type: 'string', minLength: 1, maxLength: 256 },
            expectedInstanceId: { type: 'string', minLength: 1, maxLength: 256 },
            transport: { type: 'string', enum: ['http-helper', 'code-mode'] },
            operation: { type: 'string', enum: ['beat', 'close'] },
        }, required: ['sessionId', 'expectedInstanceId', 'transport'],
    }, snapshotSchema, 'POST', ['session', 'presence', 'heartbeat'], { profile: 'core' })
    editorSessionHeartbeat(input: SessionPresenceInput = {}) {
        try {
            return this.store.heartbeat(input);
        } catch (error) {
            if (error instanceof SessionPresenceError) {
                throw new ToolError({ code: error.code, status: error.status, message: error.message });
            }
            throw error;
        }
    }
}
