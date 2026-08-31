// probe-exec-engine-live.js — extended executeJavascript smoke: node / component / skeleton
// interaction through the scene renderer. Read-only phases first, then a fully
// self-cleaning create->modify->read->destroy roundtrip. Every returned value is a
// primitive/plain-object so it survives the serialize guard.
const base = process.argv[2] ? `http://localhost:${process.argv[2]}` : 'http://localhost:49650';
let pass = 0, fail = 0, skip = 0;
const ok = (m, d) => { pass++; console.log(`  PASS ${m}${d ? ' :: ' + d : ''}`); };
const bad = (m, e) => { fail++; console.error(`  FAIL ${m} :: ${e}`); };
const skipped = (m, r) => { skip++; console.log(`  SKIP ${m} (${r})`); };

async function run(context, code, args, timeout_ms) {
  const body = { context, code };
  if (args) body.args = args;
  if (timeout_ms) body.timeout_ms = timeout_ms;
  const t0 = Date.now();
  const r = await fetch(base + '/tools/executeJavascript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { ok: r.ok, status: r.status, ms, body: j };
}

(async () => {
  console.log(`=== executeJavascript ENGINE smoke @ ${base} ===\n`);

  // ── Phase A: discovery (read-only) ────────────────────────────────
  // A1 — walk the live scene graph, count nodes + collect names
  const a1 = await run('scene', `
    const scene = cc.director.getScene();
    let count = 0; const names = [];
    const stack = [scene];
    while (stack.length) { const n = stack.pop(); count++; if (n.name) names.push(n.name); for (const c of n.children || []) stack.push(c); }
    return { count, sample: names.slice(0, 12) };
  `, null, 8000);
  a1.ok ? ok(`A1 scene walk (${a1.ms}ms)`, JSON.stringify(a1.body.result)) : bad('A1 scene walk', JSON.stringify(a1.body));
  const nodeCount = a1.body?.result?.count || 0;

  // A2 — enumerate every component class present in the scene (type registry)
  const a2 = await run('scene', `
    const scene = cc.director.getScene();
    const types = new Set();
    const stack = [scene];
    while (stack.length) { const n = stack.pop(); for (const c of n.components || []) { const t = c && (c.constructor && c.constructor.name); if (t) types.add(t); } for (const c of n.children || []) stack.push(c); }
    return Array.from(types).sort();
  `, null, 8000);
  a2.ok ? ok(`A2 component classes (${a2.ms}ms)`, (a2.body.result || []).join(',')) : bad('A2 component classes', JSON.stringify(a2.body));
  const compTypes = a2.body?.result || [];

  // A3 — skeleton / bone detection: Spine, DragonBones, 3D SkeletalAnimation
  const a3 = await run('scene', `
    const scene = cc.director.getScene();
    const found = { spine: [], dragonbones: [], skeletal3d: [] };
    const stack = [scene];
    while (stack.length) {
      const n = stack.pop();
      for (const c of n.components || []) {
        const cls = c && c.constructor ? c.constructor.name : '';
        const hasBones = !!(c && (c.skeleton || c._skeleton || c.skeletonData));
        if (cls === 'Skeleton' || cls === 'sp.Skeleton' || (c && c.skeletonData !== undefined)) found.spine.push({ node: n.name, cls, hasBones });
        if (cls === 'ArmatureDisplay' || cls.indexOf('dragonBones') >= 0) found.dragonbones.push({ node: n.name, cls });
        if (cls === 'SkeletalAnimation' || cls === 'cc.SkeletalAnimation') found.skeletal3d.push({ node: n.name, cls });
      }
      for (const c of n.children || []) stack.push(c);
    }
    return found;
  `, null, 8000);
  a3.ok ? ok(`A3 skeleton scan (${a3.ms}ms)`, JSON.stringify(a3.body.result)) : bad('A3 skeleton scan', JSON.stringify(a3.body));
  const skel = a3.body?.result || {};
  const skelTotal = (skel.spine || []).length + (skel.dragonbones || []).length + (skel.skeletal3d || []).length;
  if (skelTotal === 0) skipped('A3b skeleton presence', 'no spine/dragonbones/skeletal in this scene — engine API still reachable');

  // ── Phase B: node interaction (read-only) ─────────────────────────
  // B1 — resolve a known node (Canvas from earlier smoke) and read transform
  const b1 = await run('scene', `
    const scene = cc.director.getScene();
    let target = null; const stack = [scene];
    while (stack.length && !target) { const n = stack.pop(); if (n.name === args.name) { target = n; break; } for (const c of n.children || []) stack.push(c); }
    if (!target) return null;
    const p = target.position; const s = target.scale;
    return { name: target.name, uuid: target.uuid, pos: [p.x, p.y, p.z], scale: [s.x, s.y, s.z], active: target.active, childCount: target.children.length, compCount: target.components.length };
  `, { name: 'Canvas' }, 8000);
  b1.ok && b1.body.result ? ok(`B1 node lookup Canvas (${b1.ms}ms)`, JSON.stringify(b1.body.result)) : (b1.ok ? skipped('B1 node lookup', 'Canvas not present') : bad('B1 node lookup', JSON.stringify(b1.body)));

  // B2 — read a specific component's properties (UITransform contentSize)
  const b2 = await run('scene', `
    const scene = cc.director.getScene();
    let target = null; const stack = [scene];
    while (stack.length && !target) { const n = stack.pop(); if (n.name === args.name) { target = n; break; } for (const c of n.children || []) stack.push(c); }
    if (!target) return null;
    const ut = target.getComponent(cc.UITransform);
    if (!ut) return { hasUITransform: false };
    return { hasUITransform: true, width: ut.contentSize.width, height: ut.contentSize.height, anchorX: ut.anchorX, anchorY: ut.anchorY };
  `, { name: 'Canvas' }, 8000);
  b2.ok ? ok(`B2 UITransform read (${b2.ms}ms)`, JSON.stringify(b2.body.result)) : bad('B2 UITransform read', JSON.stringify(b2.body));

  // ── Phase C: write roundtrip (self-cleaning) ──────────────────────
  // C1 — create a node + cc.Label, set string, read back, then destroy + verify gone
  const c1 = await run('scene', `
    const scene = cc.director.getScene();
    const MARK = '__exec_smoke_probe__';
    // cleanup any leftover from a prior crashed run
    for (const n of [...scene.children]) { if (n.name === MARK) n.destroy(); }
    const node = new cc.Node(MARK);
    node.setPosition(1, 2, 3);
    const label = node.addComponent(cc.Label);
    label.string = args.text;
    scene.addChild(node);
    // read back through a fresh lookup to prove it is really in the graph
    let found = null; const stack = [scene];
    while (stack.length && !found) { const n = stack.pop(); if (n.name === MARK) { found = n; break; } for (const c of n.children || []) stack.push(c); }
    const readBack = found ? { name: found.name, pos: [found.position.x, found.position.y, found.position.z], string: found.getComponent(cc.Label).string } : null;
    // destroy + verify gone
    found.destroy();
    cc.director.tick && cc.director.tick(0.016);
    let gone = true; const stack2 = [scene];
    while (stack2.length) { const n = stack2.pop(); if (n.name === MARK) { gone = false; break; } for (const c of n.children || []) stack2.push(c); }
    return { created: !!readBack, readBack, destroyed: gone };
  `, { text: 'hello-exec' }, 8000);
  c1.ok ? ok(`C1 create->label->read->destroy (${c1.ms}ms)`, JSON.stringify(c1.body.result)) : bad('C1 roundtrip', JSON.stringify(c1.body));
  if (c1.ok && c1.body.result) {
    if (c1.body.result.created && c1.body.result.destroyed) ok('C1b roundtrip integrity', `created=${c1.body.result.created} destroyed=${c1.body.result.destroyed}`);
    else bad('C1b roundtrip integrity', JSON.stringify(c1.body.result));
  }

  // ── Phase D: skeleton API reachability (no mutation) ──────────────
  // D1 — confirm spine/skeletal constructors exist in the runtime even if scene has none
  const d1 = await run('scene', `
    return {
      hasSpineSkeleton: typeof (globalThis.sp && sp.Skeleton) !== 'undefined',
      hasSkeletalAnimation: typeof cc.SkeletalAnimation !== 'undefined',
      hasSkinnedMeshRenderer: typeof cc.SkinnedMeshRenderer !== 'undefined',
      hasAnimationController: typeof cc.animation !== 'undefined' || typeof cc.AnimationController !== 'undefined',
    };
  `, null, 5000);
  d1.ok ? ok(`D1 skeleton API reachability (${d1.ms}ms)`, JSON.stringify(d1.body.result)) : bad('D1 skeleton API', JSON.stringify(d1.body));

  console.log(`\nresult: ${pass} pass, ${fail} fail, ${skip} skip (scene nodes=${nodeCount}, compClasses=${compTypes.length})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('smoke crashed:', e.message); process.exit(1); });
