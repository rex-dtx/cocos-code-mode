// Self-check cho budget logic cua nodeBrief trong dist/scene-script.js.
// Chay: node scripts/check-node-budget.js
//
// Vi sao ton tai: nodeBrief co 2 nhanh cat doc lap (maxDepth va maxNodes) khong test
// nao chan, va scene-script chi chay trong scene process cua Creator nen khong unit-test
// truc tiep duoc. Cach lam: dung cc gia + node gia, require file da build, goi handler
// 'scene-snapshot' qua event.reply gia.
//
// ponytail: assert tran, khong framework.

const assert = require('assert');
const path = require('path');

// --- cc gia: chi nhung gi nodeBrief/scene-snapshot cham vao ---
function makeNode(name, children, components) {
    return {
        name: name,
        uuid: 'uuid-' + name,
        active: true,
        activeInHierarchy: true,
        _is3DNode: false,
        x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0,
        width: 10, height: 10, anchorX: 0.5, anchorY: 0.5,
        _objFlags: 0,
        _components: components || [],
        children: children || [],
    };
}

/** Cay day: depth level, moi node `branch` con. */
function buildTree(depth, branch, prefix) {
    prefix = prefix || 'n';
    if (depth === 0) { return makeNode(prefix, []); }
    const kids = [];
    for (let i = 0; i < branch; i++) {
        kids.push(buildTree(depth - 1, branch, prefix + '-' + i));
    }
    return makeNode(prefix, kids);
}

function countNodes(n) {
    if (!n) { return 0; }
    return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
}

// Constructor gia phai ON DINH giua cac lan loadHandlers: fakeAsset() tao object
// TRUOC khi handler chay, neu moi lan load lai sinh constructor moi thi instanceof
// so voi prototype cu -> truot het. Khai o module scope, khong trong loadHandlers.
function FakeAsset() {}
function FakeNode() {}
function FakeComponent() {}

/** Load dist/scene-script.js voi cc gia, tra module.exports cua no. */
function loadHandlers(sceneRoots) {
    const scriptPath = path.join(__dirname, '..', 'dist', 'scene-script.js');
    delete require.cache[require.resolve(scriptPath)];

    global.cc = {
        Object: { Flags: { HideInHierarchy: 1 << 10 } },
        js: { getClassName: (o) => (o && o.constructor && o.constructor.name) || null },
        director: {
            getScene: () => makeNode('Scene', sceneRoots),
        },
        find: () => null,
        Asset: FakeAsset, Node: FakeNode, Component: FakeComponent,
        view: {},
    };

    // scene-script gan module.exports tu trong IIFE -> require tra ve object handler.
    return require(scriptPath);
}

function snapshot(roots, opts) {
    const handlers = loadHandlers(roots);
    let out = null;
    let err = null;
    handlers['scene-snapshot']({ reply: (e, r) => { err = e; out = r; } }, opts);
    if (err) { throw err; }
    return out;
}

let passed = 0;
function check(label, fn) {
    fn();
    passed++;
    console.log('  ok  ' + label);
}

console.log('nodeBrief budget checks:');

// 1. Cay nho, budget rong -> tra du, khong co co truncated.
check('small tree returns complete, no truncation flags', () => {
    // depth 2, branch 2 -> 1 + 2 + 4 = 7 node
    const root = buildTree(2, 2);
    const r = snapshot([root], { maxDepth: 10, maxNodes: 100 });
    assert.strictEqual(r.budgetExhausted, false);
    assert.strictEqual(countNodes(r.children[0]), 7);
    assert.strictEqual(r.children[0].truncated, undefined);
});

// 2. maxDepth cat -> truncated:'maxDepth', childrenCount van dung, khong co children.
check('maxDepth clips and reports childrenCount', () => {
    const root = buildTree(3, 2);
    const r = snapshot([root], { maxDepth: 2, maxNodes: 1000 });
    const lvl2 = r.children[0].children[0];        // depth 2 -> bi cat
    assert.strictEqual(lvl2.truncated, 'maxDepth');
    assert.strictEqual(lvl2.childrenCount, 2, 'phai bao con that co du khong tra');
    assert.strictEqual(lvl2.children, undefined);
});

// 3. maxNodes cat cay RONG — truong hop maxDepth mot minh khong chan duoc.
check('maxNodes clips a wide-shallow tree', () => {
    const wide = makeNode('root', Array.from({ length: 500 }, (_, i) => makeNode('c' + i, [])));
    const r = snapshot([wide], { maxDepth: 10, maxNodes: 50 });
    assert.strictEqual(r.budgetExhausted, true);
    assert.strictEqual(r.children[0].truncated, 'nodeLimit');
    assert.ok(r.children[0].childrenOmitted > 0, 'phai bao bo bao nhieu con');
    // 1 root + 50 con = 51; walk khong duoc vuot xa budget.
    assert.ok(countNodes(r.children[0]) <= 52, 'walked ' + countNodes(r.children[0]));
    assert.strictEqual(r.children[0].childrenCount, 500, 'childrenCount = so con THAT');
});

// 4. childrenOmitted + so con da tra = childrenCount (khong lech, khong dem trung).
check('childrenOmitted plus returned children equals childrenCount', () => {
    const wide = makeNode('root', Array.from({ length: 100 }, (_, i) => makeNode('c' + i, [])));
    const r = snapshot([wide], { maxDepth: 10, maxNodes: 30 });
    const n = r.children[0];
    assert.strictEqual((n.children || []).length + n.childrenOmitted, n.childrenCount);
});

// 5. Budget can ngay tu con dau -> khong de lai `children: []` rong gay hieu nham.
check('exhausted budget omits the empty children array', () => {
    const wide = makeNode('root', Array.from({ length: 10 }, (_, i) => makeNode('c' + i, [])));
    const r = snapshot([wide], { maxDepth: 10, maxNodes: 1 });  // 1 root an het budget
    const n = r.children[0];
    assert.strictEqual(n.children, undefined, 'children rong phai bi xoa');
    assert.strictEqual(n.childrenOmitted, 10);
});

// 6. Budget chia CHUNG giua nhieu root, khong reset moi root.
check('budget is shared across roots, not per-root', () => {
    const roots = [
        makeNode('a', Array.from({ length: 40 }, (_, i) => makeNode('a' + i, []))),
        makeNode('b', Array.from({ length: 40 }, (_, i) => makeNode('b' + i, []))),
    ];
    const r = snapshot(roots, { maxDepth: 10, maxNodes: 20 });
    const total = r.children.reduce((s, c) => s + countNodes(c), 0);
    assert.ok(total <= 24, 'tong walked = ' + total + ', budget dang bi reset moi root?');
});

// 7. Default ap dung khi khong truyen gi (khong phai NaN/undefined).
check('defaults apply when opts omitted', () => {
    const r = snapshot([buildTree(1, 2)], undefined);
    assert.strictEqual(r.maxDepth, 6);
    assert.strictEqual(r.maxNodes, 400);
});

// 8. Editor node bi filter O ROOT (bay 2, phase 3).
check('editor roots are filtered out', () => {
    const editorRoot = makeNode('Editor Scene Background', []);
    editorRoot._objFlags = 1 << 10;
    const r = snapshot([editorRoot, makeNode('Canvas', [])], { maxDepth: 5, maxNodes: 100 });
    assert.strictEqual(r.children.length, 1);
    assert.strictEqual(r.children[0].name, 'Canvas');
});

// 9. nodesVisited phai khop so node thuc su tra ve.
check('nodesVisited matches the tree actually returned', () => {
    const root = buildTree(2, 3);   // 1 + 3 + 9 = 13
    const r = snapshot([root], { maxDepth: 10, maxNodes: 100 });
    assert.strictEqual(r.nodesVisited, countNodes(r.children[0]));
});

// --- truncateHierarchy (scene-read-tools.ts) ---
// Cung quy uoc truncated/childrenOmitted nhung KHAC code path: cai nay cat cay JSON
// tu scene:query-hierarchy o main process, khong phai node cc.* trong scene process.

/** Node giong shape scene:query-hierarchy tra ve. */
function makeHNode(name, children) {
    return { name: name, id: 'id-' + name, children: children || [] };
}

function buildHTree(depth, branch, prefix) {
    prefix = prefix || 'h';
    if (depth === 0) { return makeHNode(prefix, []); }
    const kids = [];
    for (let i = 0; i < branch; i++) {
        kids.push(buildHTree(depth - 1, branch, prefix + '-' + i));
    }
    return makeHNode(prefix, kids);
}

const { truncateHierarchy } = (function () {
    const p = path.join(__dirname, '..', 'dist', 'utcp', 'tools-2x', 'scene-read-tools.js');
    delete require.cache[require.resolve(p)];
    // File chay decorator @utcpTool luc load -> can `Editor` global toi thieu.
    global.Editor = global.Editor || { log: () => {}, warn: () => {}, error: () => {} };
    return require(p);
})();

assert.strictEqual(typeof truncateHierarchy, 'function',
    'scene-read-tools.js phai export truncateHierarchy — check nay khong duoc skip im lang');

check('truncateHierarchy: maxNodes clips a wide tree', () => {
    const wide = makeHNode('root', Array.from({ length: 300 }, (_, i) => makeHNode('c' + i, [])));
    const r = truncateHierarchy(wide, 10, { left: 40 });
    assert.strictEqual(r.truncated, 'nodeLimit');
    assert.strictEqual(r.childrenCount, 300);
    assert.strictEqual((r.children || []).length + r.childrenOmitted, 300);
});

check('truncateHierarchy: maxDepth reports reason string', () => {
    const deep = buildHTree(3, 2);
    const r = truncateHierarchy(deep, 2, { left: 1000 });
    assert.strictEqual(r.children[0].children[0].truncated, 'maxDepth');
});

check('truncateHierarchy: complete tree carries no truncation flag', () => {
    const small = buildHTree(2, 2);
    const r = truncateHierarchy(small, 10, { left: 1000 });
    assert.strictEqual(r.truncated, undefined);
    assert.strictEqual(r.children.length, 2);
    assert.strictEqual(r.childrenOmitted, undefined);
});

// --- find-by-asset (scene-script.ts, vong 1.2 phase A) ---

function fakeAsset(uuid) {
    // FakeAsset (module scope), KHONG global.cc.Asset: fakeAsset() chay TRUOC loadHandlers
    // trong moi check, luc do global.cc con la cc cua lan load truoc.
    const a = Object.create(FakeAsset.prototype);
    a._uuid = uuid;         // CCAsset that: non-enumerable. Handler doc truc tiep nen khong sao.
    return a;
}

function findByAsset(assetUuid, sceneRoots, opts) {
    const handlers = loadHandlers(sceneRoots);
    let out = null;
    let err = null;
    handlers['find-by-asset']({ reply: (e, r) => { err = e; out = r; } }, assetUuid, opts);
    if (err) { throw err; }
    return out;
}

check('find-by-asset matches a direct component property', () => {
    const comp = { spriteFrame: fakeAsset('asset-1') };
    const node = makeNode('Sprite', [], [comp]);
    const r = findByAsset('asset-1', [node], {});
    assert.strictEqual(r.nodes.length, 1);
    assert.strictEqual(r.nodes[0].property, 'spriteFrame');
    assert.strictEqual(r.nodes[0].path, 'Sprite');
});

check('find-by-asset matches a ref nested inside an array property', () => {
    const comp = { frames: [fakeAsset('other'), fakeAsset('asset-2')] };
    const node = makeNode('Anim', [], [comp]);
    const r = findByAsset('asset-2', [node], {});
    assert.strictEqual(r.nodes.length, 1);
    assert.strictEqual(r.nodes[0].property, 'frames[1]');
});

check('find-by-asset does not match an unrelated asset uuid', () => {
    const comp = { spriteFrame: fakeAsset('asset-1') };
    const node = makeNode('Sprite', [], [comp]);
    const r = findByAsset('asset-999', [node], {});
    assert.strictEqual(r.nodes.length, 0, 'khong duoc match sai uuid');
});

check('find-by-asset maxResults clips across nodes and reports truncated', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
        makeNode('n' + i, [], [{ spriteFrame: fakeAsset('shared') }]));
    const r = findByAsset('shared', nodes, { maxResults: 2 });
    assert.strictEqual(r.nodes.length, 2);
    assert.strictEqual(r.truncated, true);
});

// Guard TRONG scanComponent: 1 component nhieu prop cung match, cap nho hon so prop.
// Check tren khong phu duoc nhanh nay — no dung o guard cua walk (moi node 1 match).
// Mutation-test da chung minh: bo guard trong scanComponent thi check tren VAN xanh.
check('find-by-asset maxResults clips within a single component', () => {
    const comp = {
        a: fakeAsset('shared'), b: fakeAsset('shared'), c: fakeAsset('shared'),
        d: fakeAsset('shared'), e: fakeAsset('shared'),
    };
    const r = findByAsset('shared', [makeNode('one', [], [comp])], { maxResults: 2 });
    assert.strictEqual(r.nodes.length, 2, 'guard trong scanComponent phai cat giua vong for...in');
    assert.strictEqual(r.truncated, true);
});

console.log('\n' + passed + ' checks passed');
