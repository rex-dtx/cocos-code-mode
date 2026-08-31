const base = 'http://localhost:49650';
async function run(code){ const r=await fetch(base+'/tools/executeJavascript',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:'scene', code})}); return r.json(); }
(async()=>{
  let j=await run('return { paused: cc.game && cc.game.paused, timeScale: cc.director && cc.director.getScheduler && cc.director.getScheduler().getTimeScale(), totalFrames: cc.director && cc.director.totalFrames }');
  console.log('engine state:', JSON.stringify(j,null,1));
  j=await run('cc.game && cc.game.resume(); cc.director.getScheduler().setTimeScale(1); return { paused: cc.game.paused, timeScale: cc.director.getScheduler().getTimeScale() }');
  console.log('after resume:', JSON.stringify(j,null,1));
  j=await run(`
    const scene = cc.director.getScene();
    const MARK = '__tween_poll__';
    for (const n of [...scene.children]) if (n.name===MARK) n.destroy();
    const node = new cc.Node(MARK);
    node.setPosition(0,0,0);
    scene.addChild(node);
    cc.tween(node).to(1.0, { position: new cc.Vec3(100, 0, 0) }).start();
    return { created:true, startPos:[node.position.x, node.position.y, node.position.z] };
  `.trim());
  console.log('tween start:', JSON.stringify(j,null,1));
  for(let i=0;i<5;i++){
    await new Promise(r=>setTimeout(r,250));
    j=await run(`const scene=cc.director.getScene();let n=null;const stack=[scene];while(stack.length&&!n){const cur=stack.pop();if(cur.name==='__tween_poll__') n=cur; for(const ch of cur.children||[]) stack.push(ch);} return n? [n.position.x,n.position.y,n.position.z] : null;`);
    console.log('  t+'+(250*(i+1))+'ms pos:', JSON.stringify(j,null,1));
  }
  j=await run(`const scene=cc.director.getScene();let n=null;const s=[scene];while(s.length&&!n){const cur=s.pop();if(cur.name==='__tween_poll__') n=cur; for(const ch of cur.children||[]) s.push(ch);} if(n) n.destroy(); return {cleaned:true};`);
  console.log('cleanup:', JSON.stringify(j,null,1));
})();
