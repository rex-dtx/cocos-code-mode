import packageJSON from '../../../package.json';
import type { EditorControlSnapshot, EditorTask } from '../../utcp/editor-control-contracts';

interface TaskRow {
    root: HTMLElement;
    title: HTMLElement;
    detail: HTMLElement;
    progress: HTMLProgressElement;
    cancel: HTMLButtonElement;
}

/** Updates only its own section; never opens a panel or focuses a control. */
export class ControlView {
    private version = 0;
    private disposed = false;
    private rows = new Map<string, TaskRow>();
    private notices = new Map<string, HTMLElement>();

    constructor(private tasks: HTMLElement, private notifications: HTMLElement, private status: HTMLElement) {}

    async refresh(): Promise<void> {
        const version = ++this.version;
        try {
            const snapshot: EditorControlSnapshot = await Editor.Message.request(packageJSON.name, 'editor-control-get');
            if (this.disposed || version !== this.version) return;
            this.status.textContent = '';
            const taskIds = new Set(snapshot.tasks.map(task => task.taskId));
            for (const [id, row] of this.rows) {
                if (!taskIds.has(id)) { row.root.remove(); this.rows.delete(id); }
            }
            for (const task of snapshot.tasks) this.updateTask(task);
            const noticeIds = new Set(snapshot.notifications.map(notice => notice.id));
            for (const [id, row] of this.notices) {
                if (!noticeIds.has(id)) { row.remove(); this.notices.delete(id); }
            }
            // Insert oldest first so each new notification can be prepended.
            for (const notice of [...snapshot.notifications].reverse()) {
                if (this.notices.has(notice.id)) continue;
                const row = document.createElement('li');
                row.textContent = `[${notice.level}] ${notice.title}: ${notice.message}`;
                this.notifications.prepend(row);
                this.notices.set(notice.id, row);
            }
            this.tasks.setAttribute('aria-label', snapshot.tasks.length ? 'Agent tasks' : 'No agent tasks');
            if (!snapshot.tasks.length && !snapshot.notifications.length) this.status.textContent = 'No notifications or tasks.';
        } catch (error) {
            if (!this.disposed && version === this.version) {
                this.status.textContent = `Unable to load activity: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    }

    dispose(): void { this.disposed = true; ++this.version; this.rows.clear(); this.notices.clear(); }

    private updateTask(task: EditorTask): void {
        let row = this.rows.get(task.taskId);
        if (!row) {
            const root = document.createElement('li');
            const title = document.createElement('strong');
            const detail = document.createElement('p');
            const progress = document.createElement('progress');
            progress.max = 100;
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.onclick = async () => {
                cancel.disabled = true;
                try {
                    await Editor.Message.request(packageJSON.name, 'editor-task-cancel', { taskId: task.taskId });
                    await this.refresh();
                } catch (error) {
                    if (!this.disposed) {
                        this.status.textContent = `Cancel request failed: ${error instanceof Error ? error.message : String(error)}`;
                        cancel.disabled = false;
                    }
                }
            };
            root.append(title, detail, progress, cancel);
            this.tasks.appendChild(root);
            row = { root, title, detail, progress, cancel };
            this.rows.set(task.taskId, row);
        }
        row.title.textContent = task.title;
        row.detail.textContent = `${task.status}${task.cancelRequested ? ' — cancellation requested' : ''}${task.message ? ': ' + task.message : ''}`;
        row.progress.setAttribute('aria-label', `${task.title} progress`);
        if (task.progress === null) row.progress.removeAttribute('value');
        else row.progress.value = task.progress;
        row.cancel.textContent = task.cancelRequested ? 'Cancellation requested' : 'Request cancellation';
        row.cancel.disabled = task.status !== 'running' || task.cancelRequested;
    }
}
