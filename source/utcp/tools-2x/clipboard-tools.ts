import { utcpTool } from '../decorators';
import { panelIpc } from '../utils/ipc-promise';

export class ClipboardTools2x {
    @utcpTool(
        'nodeClipboard',
        'Copy/cut/paste nodes via editor clipboard. Copy/cut returns copied ids; paste duplicates under target.',
        {
            type: 'object',
            properties: {
                operation: { type: 'string', enum: ['copy', 'cut', 'paste', 'duplicate'], description: 'copy/cut/duplicate by selection, paste from clipboard' },
                ids: { type: 'string', description: 'Comma-separated node uuids (required for copy/cut/duplicate)' },
                targetId: { type: 'string', description: 'For paste: parent uuid to paste into' },
            },
            required: ['operation'],
        },
        { type: 'object', properties: { success: { type: 'boolean' }, ids: { type: 'array', items: { type: 'string' } } }, required: ['success'] },
        'POST', ['scene', 'node', 'copy', 'cut', 'paste', 'clipboard', 'duplicate']
    )
    async nodeClipboard(args: { operation: string, ids?: string, targetId?: string }): Promise<any> {
        const op = args.operation;
        if (op === 'paste') {
            // 2.4 scene clipboard paste — target by selecting parent then paste
            // Try scene panel messages in order
            for (const msg of ['scene:paste', 'scene:paste-node', 'scene:duplicate']) {
                try { await panelIpc('scene', msg, args.targetId || ''); return { success: true }; } catch {}
            }
            // Fallback: instruct selection-based paste
            throw new Error('Paste not supported via IPC on 2.4 — use duplicate via nodeDuplicate or manual paste in editor');
        }
        if (!args.ids) throw new Error(`${op} requires ids (comma-separated node uuids)`);
        const ids = String(args.ids).split(',').map(s => s.trim()).filter(Boolean);
        if (op === 'duplicate') {
            // Duplicate each via cc.instantiate path (reuse nodeDuplicate would be 1-by-1; do via scene-script)
            const { sceneScript } = await import('../utils/ipc-promise');
            const out: string[] = [];
            for (const id of ids) {
                const r: any = await sceneScript('duplicate-node', id);
                if (r?.uuid) out.push(r.uuid);
            }
            return { success: true, ids: out };
        }
        // copy/cut — use scene panel copy/cut messages
        const msg = op === 'cut' ? 'scene:cut' : 'scene:copy';
        for (const m of [msg, `scene:${op}-node`]) {
            try { await panelIpc('scene', m, ids); return { success: true, ids }; } catch {}
        }
        // Fallback: select then copy via Editor.Selection + scene message
        try {
            Editor.Selection.select('node', ids as any);
            await panelIpc('scene', msg);
            return { success: true, ids };
        } catch (e: any) {
            throw new Error(`nodeClipboard ${op} failed: ${e?.message || e}`);
        }
    }
}
