import { EditorAskArgs, EditorAskResult } from './editor-interaction-contracts';
import { validateAsk } from './editor-interaction-validation';
import { ToolError } from './tool-error';
import { promptEditorQuestion } from './editor-prompt';

let nativePending = false;
let cancelPending: (() => void) | undefined;

export function cancelEditorAsk(): void { cancelPending?.(); }

export function askEditor(input: EditorAskArgs): Promise<EditorAskResult> {
    const args = validateAsk(input);
    if (args.presentation !== 'native') return promptEditorQuestion(args);
    // Creator 3.7.3 exposes the native message box through info/warn/error,
    // not Dialog.messageBox. Its option names are default/cancel, not cancelId.
    const method = args.type === 'warning' ? 'warn' : args.type === 'error' ? 'error' : 'info';
    if (typeof Editor.Dialog?.[method] !== 'function') {
        throw new ToolError({ code: 'UNSUPPORTED_EDITOR_API', message: `Editor.Dialog.${method} is unavailable.` });
    }
    if (nativePending) {
        throw new ToolError({ code: 'EDITOR_INTERACTION_BUSY', status: 409, message: 'A native question is still open. Dismiss it in Creator before asking another question.' });
    }
    nativePending = true;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (result?: EditorAskResult, error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cancelPending = undefined;
            if (result) resolve(result); else reject(error);
        };
        const timer = setTimeout(() => finish({ buttonIndex: null, buttonLabel: null, cancelled: false, timedOut: true }), args.timeoutMs);
        cancelPending = () => finish({ buttonIndex: null, buttonLabel: null, cancelled: true, timedOut: false });
        Promise.resolve().then(() => Editor.Dialog[method](args.message, {
            title: args.title, detail: args.detail, buttons: args.buttons, default: 0, cancel: args.cancelId,
        })).then(result => {
            nativePending = false;
            if (settled) return;
            const index = result?.response;
            if (!Number.isInteger(index) || index < 0 || index >= args.buttons.length) {
                finish(undefined, new ToolError({ code: 'INVALID_EDITOR_RESPONSE', message: 'Creator returned an invalid message-box response.' }));
                return;
            }
            finish({ buttonIndex: index, buttonLabel: args.buttons[index], cancelled: index === args.cancelId, timedOut: false });
        }, error => {
            nativePending = false;
            finish(undefined, error);
        });
    });
}
