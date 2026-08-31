const base = process.argv[2] ? `http://localhost:${process.argv[2]}` : 'http://localhost:49650';
async function run(code, args) {
  const r = await fetch(base + '/tools/executeJavascript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: 'scene', code, args }) });
  const j = await r.json(); return { ok: r.ok, j };
}
(async () => {
  let r = await run('return { hasTween: typeof cc.tween !== "undefined", hasVec3: typeof cc.Vec3 !== "undefined", hasQuat: typeof cc.Quat !== "undefined" }');
  console.log('tween check:', JSON.stringify(r.j, null, 1));
  r = await run(`
    const scene = cc.director.getScene();
    const MARK = '__tween_probe__';
    for (const n of [...scene.children]) { if (n.name === MARK) n.destroy(); }
    const node = new cc.Node(MARK);
    node.setPosition(0,0,0);
    scene.addChild(node);
    const start = node.position.clone();
    let tweenOk = false, tweenErr = null;
    try { if (cc.tween) { cc.tween(node).to(0.5, { position: new cc.Vec3(100, 50, 0) }).start(); tweenOk = true; } } catch(e){ tweenErr = e.message; }
    return { tweenOk, tweenErr, hasTween: !!cc.tween, startPos: [start.x,start.y,start.z], nodePos: [node.position.x, node.position.y, node.position.z] };
  `);
  console.log('tween create:', JSON.stringify(r.j, null, 1));
  await new Promise(res=>setTimeout(res, 700));
  r = await run(`
    const scene = cc.director.getScene();
    let found=null; const stack=[scene];
    while(stack.length&&!found){ const n=stack.pop(); if(n.name==='__tween_probe__') found=n; for(const c of n.children||[]) stack.push(c); }
    if(!found) return { gone:true };
    const pos=[found.position.x, found.position.y, found.position.z];
    found.destroy();
    return { pos, destroyed:true };
  `);
  console.log('tween after 700ms:', JSON.stringify(r.j, null, 1));
  r = await run(`
    function bezier3(p0,p1,p2,p3,t){ const u=1-t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; }
    const p0=0,p1=10,p2=90,p3=100;
    return { t0: bezier3(p0,p1,p2,p3,0), t05: bezier3(p0,p1,p2,p3,0.5), t1: bezier3(p0,p1,p2,p3,1) };
  `);
  console.log('bezier pure:', JSON.stringify(r.j, null, 1));
  r = await run(`
    const scene = cc.director.getScene();
    const MARK2 = '__bezier_probe__';
    for (const n of [...scene.children]) { if (n.name === MARK2) n.destroy(); }
    const node = new cc.Node(MARK2);
    scene.addChild(node);
    const pts=[0,0.25,0.5,0.75,1].map(t=> {
      function b(p0,p1,p2,p3,t){ const u=1-t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; }
      return [b(0,30,70,100,t), b(0,80,20,100,t)];
    });
    node.destroy();
    return pts;
  `);
  console.log('bezier pts:', JSON.stringify(r.j, null, 1));
})();
