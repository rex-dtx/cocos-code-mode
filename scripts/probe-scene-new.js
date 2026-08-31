// probe-scene-new.js — run INSIDE Creator 3.7 editor main process.
// Usage: paste into Editor Console (main process) or run via `Editor.Message.request` from a temporary extension command.
// Returns classification without relying on editor restart.

async function probeNewScene(timeoutMs = 3000) {
    const FAKE = 'probe';
    const cases = [
        { label: 'Message.request scene:new-scene', fn: () => Editor.Message.request('scene', 'new-scene') },
        { label: 'Message.request scene:open-scene (control — should exist)', fn: () => Editor.Message.request('scene', 'query-current-scene') },
    ];
    const results = [];
    for (const c of cases) {
        const t0 = Date.now();
        try {
            const r = await Promise.race([
                c.fn(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)),
            ]);
            results.push({ label: c.label, verdict: 'reply', ms: Date.now() - t0, reply: String(r).slice(0, 200) });
        } catch (e) {
            const msg = String(e.message || e);
            const verdict = msg === 'TIMEOUT' ? 'timeout' : (/not.*exist|unknown|no.*handler/i.test(msg) ? 'not-found' : 'error');
            results.push({ label: c.label, verdict, ms: Date.now() - t0, error: msg.slice(0, 300) });
        }
    }
    // Also try sendToPanel (fire-and-forget path that cc-2x uses)
    try {
        Editor.Ipc.sendToPanel('scene', 'scene:new-scene');
        results.push({ label: "Ipc.sendToPanel scene:new-scene", verdict: 'sent (fire-and-forget, check scene afterwards)', ms: 0 });
    } catch (e) {
        results.push({ label: "Ipc.sendToPanel scene:new-scene", verdict: 'send-error', error: String(e.message || e).slice(0, 300) });
    }
    console.log('[probe-new-scene]', JSON.stringify(results, null, 2));
    // Gate rule (same as probeSceneIpc): exists/reply or sent-without-error => "expose"; not-found/timeout => "not-exposed"
    const newScene = results.find(r => r.label.includes('new-scene') && r.label.startsWith('Message'));
    console.log('[probe-new-scene gate]', newScene.verdict === 'reply' ? 'EXPOSE (has reply)' : newScene.verdict === 'timeout' ? 'NOT-EXPOSED (timeout like 14 scene:* on 2.4 probe)' : 'NOT-EXPOSED (' + newScene.verdict + ')');
    return results;
}

// Auto-run when pasted; also export for require()
if (typeof module !== 'undefined') module.exports = { probeNewScene };
probeNewScene();
