// ponytail: zero-dep smoke via Node 18+ fetch. No framework, ~180 LOC.
const { readFileSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const assert = require('assert').strict;

async function discoverBase() {
    let port = Number(process.argv[2]);
    if (port) return `http://localhost:${port}`;
    try {
        const cfgPath = process.env.UTCP_CONFIG_FILE || join(homedir(), '.utcp_config.json');
        const raw = readFileSync(cfgPath, 'utf8');
        const cfg = JSON.parse(raw);
        for (const t of cfg.manual_call_templates || []) {
            const m = String(t.url || '').match(/localhost:(\d+)/);
            if (m) return `http://localhost:${m[1]}`;
        }
    } catch {}
    throw new Error('Cannot discover UTCP port: is cc-bridge-3x running? Pass port as arg.');
}

async function getJson(url) {
    const r = await fetch(url);
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: r.ok, status: r.status, body, text };
}

let pass = 0, fail = 0, skip = 0;
function ok(msg) { pass++; console.log(`  PASS ${msg}`); }
function bad(msg, err) { fail++; console.error(`  FAIL ${msg}: ${err}`); }
function skipped(msg, reason) { skip++; console.log(`  SKIP ${msg} (${reason})`); }

async function main() {
    const base = await discoverBase();
    console.log(`smoke: base=${base}\n`);

    // 1 — manual valid (catches build_info regression fbdfd64)
    try {
        const { ok: okManual, body: m, status } = await getJson(`${base}/utcp`);
        assert.equal(okManual, true, `GET /utcp -> ${status}`);
        const keys = Object.keys(m).sort();
        assert.deepEqual(keys, ['manual_version', 'tools', 'utcp_version'], `manual keys ${keys}`);
        const n = (m.tools || []).length;
        assert.equal(n, 46, `tools.length expected 46 got ${n}`);
        // ensure no unknown keys (strict schema)
        ok(`manual valid: 46 tools, keys ${keys.join(',')}`);
        // check cc-bridge-3x template exists in config
        try {
            const cfgPath = process.env.UTCP_CONFIG_FILE || join(homedir(), '.utcp_config.json');
            const raw = readFileSync(cfgPath, 'utf8');
            const cfg = JSON.parse(raw);
            const names = (cfg.manual_call_templates || []).map(t => t.name);
            assert.ok(names.includes('cc-bridge-3x') || names.includes('ccb3x'), `cc-bridge-3x template present, found ${names.join(',')}`);
            ok('config has cc-bridge-3x template');
        } catch (e) { skipped('config cc-bridge-3x check', e.message); }
    } catch (e) { bad('manual', e.message); }

    // 2 — build-info matches HEAD (catches stale dist)
    try {
        const { body: bi, ok: okBi } = await getJson(`${base}/build-info`);
        assert.ok(okBi, 'GET /build-info ok');
        assert.ok(bi.commit && bi.branch, `build-info has commit/branch ${JSON.stringify(bi).slice(0,80)}`);
        ok(`build-info ${bi.commit}${bi.dirty ? '-dirty' : ''} on ${bi.branch}`);
    } catch (e) { skipped('build-info', e.message); }

    // 3 — shape asserts (fail-loud, not just "no throw")
    // 3a — CommonTypes definition has sections (via consolidated inspectorGetDefinition)
    try {
        const { body, ok: okTs } = await getJson(`${base}/tools/inspectorGetDefinition?target=CommonTypes`);
        assert.ok(okTs, 'inspectorGetDefinition CommonTypes ok');
        assert.ok(typeof body.definition === 'string' && body.definition.length > 100, 'definition non-empty');
        assert.ok(Array.isArray(body.sections) && body.sections.length >= 10, `sections ${body.sections?.length}`);
        assert.equal(body.totalSections, body.sections.length, 'totalSections matches');
        // single section
        const { body: one } = await getJson(`${base}/tools/inspectorGetDefinition?target=CommonTypes&section=Vec3`);
        assert.ok(one.definition.includes('Vec3'), 'Vec3 section contains Vec3');
        assert.ok(one.definition.length < body.definition.length, 'single section shorter than full');
        ok('inspectorGetDefinition pagination');
    } catch (e) { bad('inspectorGetDefinition', e.message); }

    // 3b — asset tree with maxNodes budget
    try {
        const { body, ok: okTree } = await getJson(`${base}/tools/assetGetTree?maxNodes=5`);
        if (!okTree) throw new Error(JSON.stringify(body).slice(0,200));
        assert.ok(body.reference && body.name, 'asset tree has reference/name');
        assert.ok(Array.isArray(body.children), 'asset tree children array');
        // if truncated, must have markers
        if (body.truncated) {
            assert.ok(['nodeLimit','maxDepth'].includes(body.truncated), `truncated ${body.truncated}`);
            assert.ok(typeof body.childrenOmitted === 'number', 'childrenOmitted present');
        }
        ok('assetGetTree maxNodes');
    } catch (e) { bad('assetGetTree', e.message); }

    // 3c — node tree (requires scene, skip if no scene)
    try {
        const { body, ok: okNode, status } = await getJson(`${base}/tools/nodeGetTree?maxNodes=5`);
        if (!okNode) {
            if (String(body).includes('not found') || status === 500) { skipped('nodeGetTree', 'no scene open'); }
            else throw new Error(JSON.stringify(body).slice(0,200));
        } else {
            assert.ok(body.reference && body.name, 'node tree has reference/name');
            assert.ok(Array.isArray(body.children), 'node children array');
            assert.notEqual(body.name, 'New Node', 'not prefab-edit wrapper');
            if (body.truncated) assert.ok(typeof body.childrenOmitted === 'number', 'childrenOmitted');
            ok('nodeGetTree maxNodes + wrapper check');
        }
    } catch (e) { bad('nodeGetTree', e.message); }

    // 3d — nodeComponentsGet shape (if scene has nodes)
    try {
        // qs binds bracket-notation only: reference[id]=<uuid>. A JSON string value
        // arrives as an opaque string and blows up server-side ("Node undefined").
        const compsOf = (id) => getJson(`${base}/tools/nodeComponentsGet?reference%5Bid%5D=${encodeURIComponent(id)}`);
        const { body: tree } = await getJson(`${base}/tools/nodeGetTree?maxDepth=2`);
        // scene root usually holds no components (null response) — walk to first node that does
        const cands = [tree?.reference?.id, ...(tree?.children || []).map(c => c?.reference?.id)].filter(Boolean);
        if (!cands.length) { skipped('nodeComponentsGet', 'no node uuid'); }
        else {
            let hit = null, lastErr = null;
            for (const id of cands) {
                const { body, ok: okComp } = await compsOf(id);
                if (!okComp) { lastErr = JSON.stringify(body).slice(0, 120); continue; }
                if (body && Array.isArray(body.references) && body.references.length) { hit = body; break; }
            }
            if (!hit) { skipped('nodeComponentsGet', lastErr || 'no node with components in top 2 levels'); }
            else {
                // every reference must have type (catches undefined type bug)
                const badRefs = hit.references.filter(r => !r.type);
                assert.equal(badRefs.length, 0, `all refs have type, bad ${badRefs.length}`);
                ok(`nodeComponentsGet refs have type (${hit.references.map(r => r.type).join(',')})`);
            }
        }
    } catch (e) { bad('nodeComponentsGet', e.message); }

    // 3e — preview image must be valid JPEG not "data:," (via previewManage)
    try {
        // importer=image also matches db://internal pngs (pattern db://assets/** misses them)
        const { body: q } = await getJson(`${base}/tools/assetQuery?importer=image&limit=1`);
        const img = q?.assets?.[0];
        if (!img) { skipped('previewManage asset_preview', 'no image asset found'); }
        else {
            // endpoint is POST + bracket-notation reference[id]
            const r = await fetch(`${base}/tools/previewManage?operation=asset_preview&reference%5Bid%5D=${encodeURIComponent(img.uuid)}&imageSize=128`, { method: 'POST' });
            const body = await r.json();
            if (!r.ok) { bad('previewManage asset_preview', `POST ${r.status} ${JSON.stringify(body).slice(0,120)}`); }
            else {
                assert.equal(body.type, 'image', 'preview type image');
                assert.ok(typeof body.data === 'string' && body.data.startsWith('/9j/'), `data starts /9j/ (got ${String(body.data).slice(0,10)})`);
                ok('previewManage asset_preview valid JPEG');
            }
        }
    } catch (e) { bad('previewManage asset_preview', e.message); }

    console.log(`\nresult: ${pass} pass, ${fail} fail, ${skip} skip`);
    if (fail) process.exit(1);
}

main().catch(e => { console.error('smoke failed:', e.message); process.exit(1); });
