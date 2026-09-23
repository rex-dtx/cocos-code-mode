import { EditorPopupActionArgs, EditorPopupActionResult, EditorPopupInspectResult } from './editor-popup-contracts';
import { inspectEditorPopups } from './editor-popup-observer';
import { activateWindowsPopupAction } from './windows-popup-observer';
import { notifyEditor } from './editor-control-plane';
import { promptEditorQuestion } from './editor-prompt';
import { ToolError } from './tool-error';
import { controlObject } from './editor-control-validation';

function refuse(code: string, message: string): never {
    throw new ToolError({ code, status: 409, message, recovery: 'Inspect the current popup and request an exact operator decision before retrying.' });
}

export interface PopupActionDependencies {
    inspect: typeof inspectEditorPopups;
    approve: typeof promptEditorQuestion;
    activate: typeof activateWindowsPopupAction;
    notify: typeof notifyEditor;
}

const defaultDependencies: PopupActionDependencies = {
    inspect: inspectEditorPopups,
    approve: promptEditorQuestion,
    activate: activateWindowsPopupAction,
    notify: notifyEditor,
};

export async function actOnEditorPopup(input: EditorPopupActionArgs, dependencies: PopupActionDependencies = defaultDependencies): Promise<EditorPopupActionResult> {
    const args = controlObject(input, ['operation', 'popupId', 'popupTitle', 'actionId', 'actionLabel', 'confirm', 'authorization']);
    if ((args.operation !== 'remind' && args.operation !== 'activate') || typeof args.popupId !== 'string' || !/^native:\d+:0X[0-9A-F]+$/i.test(args.popupId) || typeof args.popupTitle !== 'string' || args.popupTitle.length > 256) refuse('POPUP_ACTION_INVALID', 'A native popup identity and exact title are required.');
    const snapshot: EditorPopupInspectResult = await dependencies.inspect({ includeNative: true, maxItems: 32 });
    const popup = snapshot.windows.find(window => window.id === args.popupId && window.title === args.popupTitle);
    if (!snapshot.complete || !popup || !popup.visible || !popup.ownerVerified || popup.classification !== 'dialog' || !popup.signals.includes('native-dialog-class')) refuse('POPUP_ACTION_STALE', 'The verified native popup is unavailable or changed.');
    if (args.operation === 'remind') {
        const labels = popup.actions.map(action => action.label).filter(Boolean).slice(0, 16);
        const notice = dependencies.notify({ title: 'Creator popup needs review', message: `Popup ${popup.title || '(untitled)'} is blocking the editor. Available buttons: ${labels.join(', ') || 'unavailable'}. Review in Creator; no button was activated.`, level: 'warning' });
        return { operation: 'remind', popupId: popup.id, actionId: null, actionLabel: null, activated: false, closed: false, reminderId: notice.id };
    }
    const action = popup.actions.find(item => item.id === args.actionId && item.label === args.actionLabel && item.enabled);
    const owner = snapshot.windows.find(window => window.id === popup.parentId && window.classification === 'creator-main' && window.ownerVerified && window.visible && window.signals.includes('native-class:Chrome_WidgetWin_1'));
    const trackedFixture = popup.signals.includes('tracked-creator-fixture');
    if (!action || !owner || !popup.signals.includes('native-owner') || (trackedFixture && action.label !== 'Cancel')) refuse('POPUP_ACTION_STALE', 'The requested popup button is missing, disabled or ownership is unverified.');
    const answer = await dependencies.approve({ title: 'Approve Creator popup action', message: `Activate ${action.label} on ${popup.title || '(untitled)'}?`, buttons: ['Do not activate', 'Activate'], cancelId: 0, timeoutMs: 60000, openPanel: false });
    if (answer.buttonIndex !== 1 || answer.cancelled || answer.timedOut) refuse('POPUP_ACTION_UNAUTHORIZED', 'The operator did not approve this exact popup action.');
    let activated: { activated: boolean, closed: boolean };
    try {
        activated = await dependencies.activate(popup.id, action.id, popup.title, action.label, owner.id, owner.title, 'Chrome_WidgetWin_1');
    } catch {
        refuse('POPUP_ACTION_UNCONFIRMED', 'Native action failed or popup identity changed; no successful action is claimed.');
    }
    const after = await dependencies.inspect({ includeNative: true, maxItems: 32 });
    if (!after.complete || after.windows.some(window => window.id === popup.id)) refuse('POPUP_ACTION_UNCONFIRMED', 'The targeted popup did not close after activation.');
    return { operation: 'activate', popupId: popup.id, actionId: action.id, actionLabel: action.label, activated: activated!.activated, closed: true, reminderId: null };
}
