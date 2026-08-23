#!/usr/bin/env node
// audit-registry-coverage — doi chieu docs/cc-3x7-message-registry.json (dump 3.7.3)
// voi cac Editor.Message.request(<module>, <msg>) that su dung trong source/.
// Muc dich: tim message CO trong API docs ma tool surface chua expose.
// Chay: node scripts/audit-registry-coverage.js [--unused] [--module <name>]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'docs', 'cc-3x7-message-registry.json');
const TYPES_PKGS = path.join(ROOT, 'node_modules', '@cocos', 'creator-types', 'editor', 'packages');

// The registry is a raw dump of contributions.messages — it includes event
// listeners and panel plumbing. The TYPED surface (`<pkg>/@types/message.d.ts`)
// is the subset Cocos actually documents as callable API, so a message that is
// typed-but-unused is a much stronger "not implemented" signal.
function loadTypedMessages() {
    const typed = new Map(); // "mod::msg" -> params signature line
    if (!fs.existsSync(TYPES_PKGS)) return typed;
    for (const pkg of fs.readdirSync(TYPES_PKGS)) {
        const f = path.join(TYPES_PKGS, pkg, '@types', 'message.d.ts');
        if (!fs.existsSync(f)) continue;
        const src = fs.readFileSync(f, 'utf8');
        // Top-level keys are indented exactly 4 spaces inside the interface.
        const re = /^ {4}'([^']+)':\s*\{/gm;
        let m;
        while ((m = re.exec(src))) {
            const after = src.slice(m.index, m.index + 400);
            const params = (after.match(/params:\s*(\[[^\]]*\]|\[\])/) || [])[1] || '';
            typed.set(`${pkg}::${m[1]}`, params.replace(/\s+/g, ' ').slice(0, 120));
        }
    }
    return typed;
}

function loadRegistry() {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    const all = new Map(); // "mod::msg" -> {public, doc}
    for (const [mod, msgs] of Object.entries(reg)) {
        for (const [name, def] of Object.entries(msgs)) {
            all.set(`${mod}::${name}`, { public: !!def.public, doc: def.doc || '', mod, name });
        }
    }
    return { reg, all };
}

// Every literal Editor.Message.request('<mod>', '<msg>') in source/.
// Some tools dispatch dynamically (fallback candidate lists, operation->message
// maps), so a second pass credits any registry message name that appears as a
// bare string literal anywhere in source — weaker evidence, but it keeps
// break-task / query-asset-used out of the "missing" list.
function collectUsed(registryNames) {
    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.ts')) files.push(p);
        }
    })(path.join(ROOT, 'source'));

    const used = new Map(); // "mod::msg" -> [files]
    const dynamicNames = new Map(); // bare msg name -> [files]
    const dynamicModules = new Set(); // modules that dispatch dynamically
    const dynamic = [];
    const literal = /Editor\.Message\.request\(\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g;
    const computed = /Editor\.Message\.request\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$.]*)/g;
    const anyString = /['"`]([a-z][a-z0-9-]*(?:-[a-z0-9]+)+)['"`]/g;

    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const rel = path.relative(ROOT, f);
        let m;
        while ((m = literal.exec(src))) {
            const key = `${m[1]}::${m[2]}`;
            if (!used.has(key)) used.set(key, []);
            used.get(key).push(rel);
        }
        while ((m = computed.exec(src))) {
            dynamic.push(`${m[1]}::<${m[2]}>  (${rel})`);
            dynamicModules.add(m[1]);
        }
        while ((m = anyString.exec(src))) {
            if (!registryNames.has(m[1])) continue;
            if (!dynamicNames.has(m[1])) dynamicNames.set(m[1], []);
            if (!dynamicNames.get(m[1]).includes(rel)) dynamicNames.get(m[1]).push(rel);
        }
    }
    return { used, dynamicNames, dynamicModules, dynamic, fileCount: files.length };
}

// Registry contains a lot of noise for our purposes:
//  - event listeners the editor broadcasts AT packages (scene:ready, asset-db:asset-add)
//  - panel/UI plumbing (open, open-devtools, dialog-*, change-*-tab)
//  - other packages' internal wiring (packer-driver/*, request-to-build-worker)
// None of these are callable tools. Filter so the "missing" list is signal.
const NOISE_EXACT = new Set([
    'open', 'open-devtools', 'open-panel-devtools', 'open-worker-devtools', 'open-dev-tools',
    'open-docs', 'open-terminal', 'reload-terminal', 'open-settings', 'open-joint',
    'change-settings-tab', 'refresh-settings-tab', 'change-debug-mode', 'preferences-changed',
    'register-package', 'unregister-package', 'notice-reload-editor', 'full-screen',
    'quit-editor', 'create-asset-dialog', 'information-dialog', 'has-dialog', 'close-dialog',
    'dialog-warn', 'install-extension', 'graphical-tools', 'debug-view',
]);
const NOISE_PREFIX = [
    'scene:', 'asset-db:', 'selection:', 'project:', 'engine:', 'programming:', 'builder:',
    'preview:', 'build-worker:', 'console:', 'animation-graph:', 'i18n:', 'edit-mode:',
    'shortcuts:', 'packer-driver/', 'menu:',
];

function isNoise(mod, name) {
    if (NOISE_EXACT.has(name)) return true;
    // A "mod:" prefixed name inside a DIFFERENT module is an inbound broadcast listener.
    for (const p of NOISE_PREFIX) {
        if (name.startsWith(p) && !name.startsWith(`${mod}:`)) return true;
    }
    // Same-module prefixed names are also listeners in practice (scene::scene:ready).
    if (name.startsWith(`${mod}:`)) return true;
    return false;
}

function main() {
    const args = process.argv.slice(2);
    const onlyModule = args.includes('--module') ? args[args.indexOf('--module') + 1] : null;

    const { reg, all } = loadRegistry();
    const typed = loadTypedMessages();
    // Credit dynamic dispatch against BOTH name sets: assetFindReferences keeps
    // `query-asset-users` (3.8 name) alongside `query-asset-used` (3.7.3 typo)
    // in a fallback list, and only the latter is in the 3.7.3 registry.
    const knownNames = new Set([
        ...[...all.values()].map((d) => d.name),
        ...[...typed.keys()].map((k) => k.slice(k.indexOf('::') + 2)),
    ]);
    const { used, dynamicNames, dynamicModules, dynamic, fileCount } = collectUsed(knownNames);

    console.log(`registry: ${Object.keys(reg).length} modules, ${all.size} messages (dump 3.7.3)`);
    console.log(`typed:    ${typed.size} documented callables from @cocos/creator-types message.d.ts`);
    console.log(`source:   ${fileCount} .ts files, ${used.size} distinct literal request pairs, ${dynamic.length} dynamic call sites (${[...dynamicModules].join(', ')})\n`);

    // STRONG SIGNAL: typed (documented) messages never called from source.
    // Credit is per-NAME, not per-module: excluding a whole module because it has
    // one dynamic dispatch site would hide real gaps (asset-db dispatches a
    // used_by/depends_on fallback list, but still never calls query-ready).
    const typedUnused = [...typed.entries()].filter(([key]) => {
        const mod = key.split('::')[0];
        const name = key.slice(key.indexOf('::') + 2);
        if (used.has(key)) return false;
        if (dynamicNames.has(name)) return false;
        if (isNoise(mod, name)) return false;
        return true;
    });
    const byMod = {};
    for (const [key, sig] of typedUnused) {
        const mod = key.split('::')[0];
        (byMod[mod] = byMod[mod] || []).push([key.slice(key.indexOf('::') + 2), sig]);
    }
    console.log(`=== TYPED (documented) but NEVER called — ${typedUnused.length} candidates ===`);
    for (const mod of Object.keys(byMod).sort()) {
        console.log(`\n[${mod}] ${byMod[mod].length}`);
        for (const [name, sig] of byMod[mod]) console.log(`    ${name}  ${sig}`);
    }
    console.log('\n');

    // Per-module coverage, counting only callable (non-noise) messages.
    const rows = [];
    for (const mod of Object.keys(reg)) {
        const callable = Object.keys(reg[mod]).filter((n) => !isNoise(mod, n));
        const usedHere = [...used.keys()].filter((k) => k.startsWith(`${mod}::`));
        const missing = callable.filter((n) => !used.has(`${mod}::${n}`) && !dynamicNames.has(n));
        const viaDynamic = callable.filter((n) => !used.has(`${mod}::${n}`) && dynamicNames.has(n));
        rows.push({ mod, used: usedHere.length, viaDynamic, callable: callable.length, total: Object.keys(reg[mod]).length, missing });
    }
    rows.sort((a, b) => b.used - a.used || b.callable - a.callable);

    console.log('MODULE             direct  dynamic  callable  total   uncovered');
    for (const r of rows) {
        if (onlyModule && r.mod !== onlyModule) continue;
        console.log(
            (r.mod || '(empty)').padEnd(19) +
            String(r.used).padEnd(8) +
            String(r.viaDynamic.length).padEnd(9) +
            String(r.callable).padEnd(10) +
            String(r.total).padEnd(8) +
            r.missing.length
        );
    }

    // Messages we call that the 3.7.3 dump does not contain: either renamed
    // between versions (we keep both names behind try/catch) or genuinely absent.
    const notInRegistry = [...used.keys()].filter((k) => !all.has(k));
    console.log(`\n=== USED but absent from 3.7.3 registry (${notInRegistry.length}) ===`);
    for (const k of notInRegistry.sort()) console.log(`  ${k}   <- ${used.get(k).join(', ')}`);

    // The actual answer to "what's in the docs that we haven't implemented".
    console.log('\n=== CALLABLE in registry, NOT called anywhere in source ===');
    for (const r of rows) {
        if (onlyModule && r.mod !== onlyModule) continue;
        if (!r.missing.length) continue;
        console.log(`\n[${r.mod}] ${r.missing.length} uncovered`);
        for (const n of r.missing) {
            const def = all.get(`${r.mod}::${n}`);
            const flag = def.public ? 'PUBLIC' : '      ';
            const doc = def.doc ? ` :: ${def.doc.replace(/\s+/g, ' ').slice(0, 100)}` : '';
            console.log(`  ${flag}  ${n}${doc}`);
        }
    }

    if (dynamic.length) {
        console.log('\n=== dynamic dispatch call sites (message name computed at runtime) ===');
        for (const d of [...new Set(dynamic)].sort()) console.log(`  ${d}`);
        const credited = rows.flatMap((r) => r.viaDynamic.map((n) => `${r.mod}::${n}`));
        if (credited.length) {
            console.log(`\n  credited via string-literal match (${credited.length}): ${credited.sort().join(', ')}`);
        }
    }
}

main();
