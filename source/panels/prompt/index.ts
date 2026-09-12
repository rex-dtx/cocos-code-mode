import packageJSON from '../../../package.json';
import type { EditorInteractionRequest } from '../../utcp/editor-interaction-contracts';
import { ControlView } from './control-view';

interface PromptPanel {
    $: Record<'title' | 'message' | 'form' | 'fields' | 'submit' | 'cancel' | 'status' | 'tasks' | 'notifications' | 'controlStatus', HTMLElement>;
}
let current: EditorInteractionRequest | undefined;
let expiryTimer: NodeJS.Timeout | undefined;
let generation = 0;
const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
let onChanged: (() => void) | undefined;
let onFinished: ((requestId: string, status: string) => void) | undefined;
let onControlChanged: (() => void) | undefined;
let controlView: ControlView | undefined;
// These listener APIs exist in Creator 3.7.3 but are absent from creator-types.
const messages = Editor.Message as typeof Editor.Message & {
    addBroadcastListener(event: string, listener: Function): void;
    removeBroadcastListener(event: string, listener: Function): void;
};

function clearForm(panel: PromptPanel, requestId: string, status: string): void {
    if (current?.requestId !== requestId) return;
    current = undefined;
    clearTimeout(expiryTimer);
    expiryTimer = undefined;
    controls.clear();
    panel.$.fields.replaceChildren();
    panel.$.title.textContent = 'Agent prompt';
    panel.$.message.textContent = '';
    panel.$.form.hidden = true;
    panel.$.status.textContent = status;
}

async function respond(panel: PromptPanel, action: 'submit' | 'cancel' | 'choose', buttonIndex?: number): Promise<void> {
    if (!current) return;
    const requestId = current.requestId;
    const values: Record<string, string | boolean> = {};
    if (action === 'submit' && current.kind === 'form') {
        if (!(panel.$.form as HTMLFormElement).reportValidity()) return;
        for (const field of current.fields) {
            const control = controls.get(field.name)!;
            values[field.name] = field.type === 'confirm' ? (control as HTMLInputElement).checked : control.value;
        }
    }
    (panel.$.submit as HTMLButtonElement).disabled = true;
    try {
        const result = await Editor.Message.request(packageJSON.name, 'editor-prompt-response', { requestId, action, ...(action === 'submit' ? { values } : {}), ...(action === 'choose' ? { buttonIndex } : {}) });
        clearForm(panel, requestId, result.accepted ? (action === 'cancel' ? 'Cancelled.' : 'Submitted.') : 'This request is no longer active.');
    } catch (error) {
        if (current?.requestId === requestId) {
            panel.$.status.textContent = error instanceof Error ? error.message : String(error);
            (panel.$.submit as HTMLButtonElement).disabled = false;
        }
    }
}
async function showPrompt(panel: PromptPanel): Promise<void> {
    const version = ++generation;
    try {
        const request: EditorInteractionRequest | null = await Editor.Message.request(packageJSON.name, 'editor-prompt-get');
        if (version !== generation) return;
        if (!request || request.expiresAt <= Date.now()) {
            if (current) clearForm(panel, current.requestId, 'No active request.');
            return;
        }
        if (current) clearForm(panel, current.requestId, '');
        current = request;
        panel.$.title.textContent = request.title;
        panel.$.message.textContent = request.message + (request.kind === 'question' && request.detail ? `\n\n${request.detail}` : '');
        panel.$.status.textContent = '';
        panel.$.form.hidden = false;
        (panel.$.submit as HTMLButtonElement).disabled = false;
        panel.$.submit.hidden = request.kind === 'question';
        if (request.kind === 'question') {
            request.buttons.forEach((label, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = label;
                button.onclick = () => { void respond(panel, 'choose', index); };
                panel.$.fields.appendChild(button);
            });
        }
        for (const field of request.kind === 'form' ? request.fields : []) {
            const row = document.createElement('label');
            const caption = document.createElement('span');
            caption.textContent = `${field.label}${field.required ? ' (required)' : ''}`;
            row.appendChild(caption);
            let control: HTMLInputElement | HTMLSelectElement;
            if (field.type === 'select') {
                control = document.createElement('select');
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = 'Choose an option';
                control.appendChild(empty);
                for (const option of field.options) {
                    const item = document.createElement('option');
                    item.value = option;
                    item.textContent = option;
                    control.appendChild(item);
                }
                control.value = field.defaultValue ?? '';
            } else {
                control = document.createElement('input');
                control.type = field.type === 'confirm' ? 'checkbox' : 'text';
                if (field.type === 'confirm') control.checked = field.defaultValue ?? false;
                else {
                    control.maxLength = field.maxLength ?? 4096;
                    control.value = field.defaultValue ?? '';
                }
            }
            control.required = field.required ?? false;
            control.name = field.name;
            row.appendChild(control);
            panel.$.fields.appendChild(row);
            controls.set(field.name, control);
        }
        // Also clear sensitive form values if main-process cleanup IPC is lost.
        expiryTimer = setTimeout(() => clearForm(panel, request.requestId, 'Timed out.'), Math.max(0, request.expiresAt - Date.now()));
    } catch (error) {
        if (version === generation) panel.$.status.textContent = `Unable to load prompt: ${error instanceof Error ? error.message : String(error)}`;
    }
}

module.exports = Editor.Panel.define({
    template: `<section><h2 id="title">Agent Inbox</h2><p id="message"></p>
        <form id="form" hidden><div id="fields"></div><footer><button id="submit" type="submit">Submit</button>
        <button id="cancel" type="button">Cancel</button></footer></form><p id="status" role="status">Waiting for an agent request.</p>
        <section class="activity"><h3>Agent tasks</h3><ul id="tasks"></ul>
        <h3>Notifications</h3><ul id="notifications"></ul><p id="control-status" role="status"></p></section></section>`,
    style: `section { padding: 16px; overflow: auto; height: 100%; box-sizing: border-box; }
        section.activity { padding: 0; height: auto; } .activity ul { padding: 0; list-style: none; }
        .activity li { padding: 8px 0; border-bottom: 1px solid #555; overflow-wrap: anywhere; white-space: pre-wrap; }
        .activity progress { display: block; width: 100%; margin: 8px 0; }
        h2, p, span { white-space: pre-wrap; overflow-wrap: anywhere; }
        label { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
        input, select, button { font: inherit; } input[type=checkbox] { align-self: flex-start; }
        input[type=text], select { width: 100%; box-sizing: border-box; }
        footer { display: flex; gap: 8px; margin-top: 16px; }`,
    $: { title: '#title', message: '#message', form: '#form', fields: '#fields', submit: '#submit', cancel: '#cancel', status: '#status', tasks: '#tasks', notifications: '#notifications', controlStatus: '#control-status' },
    ready() {
        const panel = this as unknown as PromptPanel;
        onChanged = () => { void showPrompt(panel); };
        onFinished = (requestId, status) => {
            clearForm(panel, requestId, status === 'submitted' ? 'Submitted.' : status === 'timedOut' ? 'Timed out.' : 'Cancelled.');
            void showPrompt(panel);
        };
        messages.addBroadcastListener(`${packageJSON.name}:editor-prompt-changed`, onChanged);
        messages.addBroadcastListener(`${packageJSON.name}:editor-prompt-finished`, onFinished);
        controlView = new ControlView(panel.$.tasks, panel.$.notifications, panel.$.controlStatus);
        onControlChanged = () => { void controlView?.refresh(); };
        messages.addBroadcastListener(`${packageJSON.name}:editor-control-changed`, onControlChanged);
        void controlView.refresh();
        panel.$.form.onsubmit = event => { event.preventDefault(); void respond(panel, 'submit'); };
        panel.$.cancel.onclick = () => { void respond(panel, 'cancel'); };
        panel.$.form.onkeydown = event => {
            if (event.key === 'Escape') { event.preventDefault(); void respond(panel, 'cancel'); }
        };
    },
    update() {
        void showPrompt(this as unknown as PromptPanel);
        void controlView?.refresh();
    },
    close() {
        ++generation;
        if (onControlChanged) messages.removeBroadcastListener(`${packageJSON.name}:editor-control-changed`, onControlChanged);
        onControlChanged = undefined;
        controlView?.dispose();
        controlView = undefined;
        if (onChanged) messages.removeBroadcastListener(`${packageJSON.name}:editor-prompt-changed`, onChanged);
        if (onFinished) messages.removeBroadcastListener(`${packageJSON.name}:editor-prompt-finished`, onFinished);
        onChanged = undefined;
        onFinished = undefined;
        if (!current) return;
        const requestId = current.requestId;
        clearForm(this as unknown as PromptPanel, requestId, 'Cancelled.');
        Editor.Message.send(packageJSON.name, 'editor-prompt-response', { requestId, action: 'cancel' });
    },
});
