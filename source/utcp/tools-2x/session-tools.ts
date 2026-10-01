import type { JsonSchema } from '@utcp/sdk';
import { utcpTool } from '../decorators';
import { SessionPresenceError, SessionPresenceInput, SessionPresenceStore } from '../session-presence';
import { ToolError } from '../tool-error';

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

    @utcpTool('editorSessionHeartbeat', 'Record a caller-declared editor session heartbeat. Presence is advisory: it does not authenticate the caller, lock the editor, or prove a chat/model or game runtime is alive.', {
        type: 'object', additionalProperties: false,
        properties: {
            sessionId: { type: 'string', minLength: 1, maxLength: 128 },
            label: { type: 'string', minLength: 1, maxLength: 256 },
            expectedInstanceId: { type: 'string', minLength: 1, maxLength: 256 },
            transport: { type: 'string', enum: ['http-helper', 'code-mode'] },
            operation: { type: 'string', enum: ['beat', 'close'] },
        }, required: ['sessionId', 'expectedInstanceId', 'transport'],
    }, snapshotSchema, 'POST', ['session', 'presence', 'heartbeat'])
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
