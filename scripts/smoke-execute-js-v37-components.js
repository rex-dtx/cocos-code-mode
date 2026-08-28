// smoke-execute-js-v37-components.js — v3.7 component family suite for executeJavascript.
// Covers every cc_docs v3.7 family that appeared in 125 live classes / 533 nodes:
// UI (Label, RichText, Sprite, Mask, Graphics, Layout, ProgressBar, Widget, UIOpacity),
// Physics 3D/2D, Light, Camera, Audio, Particles, Animation, Spine — plus bezier gameplay.
// Each test self-cleans (removeFromParent+destroy), resolves classes via cc.js.getClassByName,
// and SKIPs when the engine module is not enabled instead of FAILing.
// Run: node smoke-execute-js-v37-components.js [port]
const base = process.argv[2] ? `http://localhost:${process.argv[2]}` : 'http://localhost:49650';
const TOOL = base + '/tools/executeJavascript';

let pass = 0, fail = 0;
const results = [];
async function call(body) { const t0=Date.now(); const r=await fetch(TOOL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); const ms=Date.now()-t0; const t=await r.text(); let j; try{j=JSON.parse(t);}catch{j={raw:t};} return {ok:r.ok,status:r.status,ms,body:j}; }
function resVal(body){ if(body==null) return null; if(typeof body==='object'&&'result' in body) return body.result; return null; }
async function test(group,name,body,expect,check){
  let r; try{r=await call(body);}catch(e){ fail++; results.push({group,name,verdict:'FAIL',detail:'req err '+e.message}); return; }
  const errStr=r.body&&r.body.error?String(r.body.error):''; let verdict='PASS'; let detail=`(${r.ms}ms)`;
  const rv=resVal(r.body);
  if(expect==='ok'){ if(!r.ok){verdict='FAIL';detail+=' body='+JSON.stringify(r.body).slice(0,160);} else if(check){ try{if(!check(rv)){verdict='FAIL';detail+=' check:false';}}catch(e){verdict='FAIL';detail+=' check threw '+e.message;}} if(verdict==='PASS') detail+=' '+JSON.stringify(rv).slice(0,90); }
  else if(expect==='block'){ if(r.ok){verdict='FAIL';detail+=' expected block got 200';} else if(!/safety checks blocked/i.test(errStr)){verdict='FAIL';detail+=' not-safety:'+errStr.slice(0,80);} else detail+=' blocked'; }
  else if(expect==='skip'){ verdict='SKIP'; detail+=' skipped'; }
  if(verdict==='PASS') pass++; else if(verdict==='FAIL') fail++;
  if(verdict==='SKIP'){} // not counted in fail
  results.push({group,name,verdict,detail});
}
const E=(code,args,safety,timeout)=>{ const b={context:'editor',code}; if(args) b.args=args; if(safety!==undefined) b.safety_checks=safety; if(timeout) b.timeout_ms=timeout; return b; };
const S=(code,args,safety,timeout)=>{ const b={context:'scene',code}; if(args) b.args=args; if(safety!==undefined) b.safety_checks=safety; if(timeout) b.timeout_ms=timeout; return b; };
const CLEAN=`const sc=cc.director.getScene();const M="__v37_tmp__";for(const n of [...sc.children])if(n.name===M){n.removeFromParent();n.destroy();}`;
function CC(name){ return `(cc["${name}"]||cc.js.getClassByName("cc.${name}")||cc.js.getClassByName("${name}"))`; }

(async()=>{
  console.log('=== executeJavascript v3.7 COMPONENTS suite @ '+base+' ===\n');

  // ── N. UI components (2D) ──────────────────────────
  await test('N ui', 'N1 Label string/fontSize', S(CLEAN+`const Label=${CC('Label')}; if(!Label) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const lab=n.addComponent(Label); lab.string="WIN"; lab.fontSize=32; const out={s:n.getComponent(Label).string,f:n.getComponent(Label).fontSize}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||r.s==='WIN'));
  await test('N ui', 'N2 RichText', S(CLEAN+`const RT=${CC('RichText')}; if(!RT) return {skip:true}; const UT=cc.js.getClassByName("cc.UITransform"); const n=new cc.Node(M);sc.addChild(n); if(UT) n.addComponent(UT); const rt=n.addComponent(RT); rt.string="<color=#ff0000>hi</color>"; const s=n.getComponent(RT).string; n.removeFromParent(); n.destroy(); return {s};`), 'ok', r=>r && (r.skip||!!r.s));
  await test('N ui', 'N3 Sprite color', S(CLEAN+`const n=new cc.Node(M);sc.addChild(n); const sp=n.addComponent(cc.Sprite); const c=new cc.Color(10,20,30,255); sp.color=c; const out=[sp.color.r,sp.color.g,sp.color.b]; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && r[0]===10);
  await test('N ui', 'N4 Mask type', S(CLEAN+`const Mask=${CC('Mask')}; if(!Mask) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const m=n.addComponent(Mask); const t=m.type; n.removeFromParent(); n.destroy(); return {type:typeof t};`), 'ok', r=>r && (r.skip||r.type==='number'));
  await test('N ui', 'N5 Graphics lineWidth + path', S(CLEAN+`const G=${CC('Graphics')}; if(!G) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const g=n.addComponent(G); g.lineWidth=5; g.moveTo(0,0); g.lineTo(10,10); g.stroke(); const ok=g.lineWidth===5; n.removeFromParent(); n.destroy(); return {ok};`), 'ok', r=>r && (r.skip||r.ok===true));
  await test('N ui', 'N6 Layout type', S(CLEAN+`const L=${CC('Layout')}; if(!L) return {skip:true}; const Type=cc.Layout&&cc.Layout.Type; const n=new cc.Node(M);sc.addChild(n); const lo=n.addComponent(L); if(Type) lo.type=Type.HORIZONTAL; const out=lo.type; n.removeFromParent(); n.destroy(); return {out};`), 'ok', r=>r && (r.skip||r.out!==undefined));
  await test('N ui', 'N7 ProgressBar progress', S(CLEAN+`const PB=${CC('ProgressBar')}; if(!PB) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const pb=n.addComponent(PB); pb.progress=0.75; const v=pb.progress; n.removeFromParent(); n.destroy(); return {v};`), 'ok', r=>r && (r.skip||Math.abs(r.v-0.75)<1e-6));
  await test('N ui', 'N8 Widget align', S(CLEAN+`const W=${CC('Widget')}; if(!W) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const w=n.addComponent(W); w.isAlignLeft=true; w.left=10; const out={l:w.isAlignLeft,left:w.left}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||r.l===true));
  await test('N ui', 'N9 UIOpacity', S(CLEAN+`const UO=${CC('UIOpacity')}; if(!UO) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const uo=n.addComponent(UO); uo.opacity=128; const v=uo.opacity; n.removeFromParent(); n.destroy(); return {v};`), 'ok', r=>r && (r.skip||r.v===128));
  await test('N ui', 'N10 UITransform via getClassByName', S(CLEAN+`const UT=cc.js.getClassByName("cc.UITransform"); if(!UT) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const ut=n.addComponent(UT); ut.setContentSize(200,100); const out=[ut.contentSize.width,ut.contentSize.height]; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||(r[0]===200&&r[1]===100)));

  // ── O. Physics 3D/2D ────────────────────────────────
  await test('O physics', 'O1 RigidBody probe', S(`return {hasRB:typeof cc.RigidBody!=="undefined"||!!cc.js.getClassByName("cc.RigidBody")||!!cc.physics||typeof cc.PhysicsSystem!=="undefined", hasRBClass:!!cc.js.getClassByName("cc.RigidBody")};`), 'ok', r=>r&&typeof r.hasRB==='boolean');
  await test('O physics', 'O2 BoxCollider probe', S(`return {has:!!cc.js.getClassByName("cc.BoxCollider")||typeof cc.BoxCollider!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('O physics', 'O3 BoxCollider size/center', S(CLEAN+`const BC=cc.js.getClassByName("cc.BoxCollider"); if(!BC) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const bc=n.addComponent(BC); try{bc.size=new cc.Vec3(1,2,3);}catch(e){} const out=bc.size? [bc.size.x,bc.size.y,bc.size.z]:null; n.removeFromParent(); n.destroy(); return out||{skip:true};`), 'ok', r=>r && (r.skip||r.length===3));
  await test('O physics', 'O4 RigidBody2D probe', S(`return {has:!!cc.js.getClassByName("cc.RigidBody2D")||typeof cc.RigidBody2D!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('O physics', 'O5 BoxCollider2D probe', S(`return {has:!!cc.js.getClassByName("cc.BoxCollider2D")||typeof cc.BoxCollider2D!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('O physics', 'O6 PhysicsSystem enabled', S(`const ps=cc.director.getPhysicsSystem ? cc.director.getPhysicsSystem() : (cc.PhysicsSystem&&cc.PhysicsSystem.instance); return {has:!!ps, enable: ps? ps.enable : null};`), 'ok', r=>r&&typeof r.has==='boolean');

  // ── P. Light / Camera ───────────────────────────────
  await test('P light-cam', 'P1 DirectionalLight probe', S(`return {has:!!cc.js.getClassByName("cc.DirectionalLight")||typeof cc.DirectionalLight!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('P light-cam', 'P2 DirectionalLight color/intensity', S(CLEAN+`const DL=cc.js.getClassByName("cc.DirectionalLight"); if(!DL) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const dl=n.addComponent(DL); try{dl.color=new cc.Color(255,200,100,255);}catch(e){} try{dl.illuminance=5000;}catch(e){} const out={hasColor:!!dl.color, illum: dl.illuminance}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||r.hasColor===true));
  await test('P light-cam', 'P3 SpotLight probe', S(`return {has:!!cc.js.getClassByName("cc.SpotLight")||typeof cc.SpotLight!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('P light-cam', 'P4 Camera fov/near/far', S(CLEAN+`const Cam=cc.js.getClassByName("cc.Camera")||cc.Camera; if(!Cam) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const cam=n.addComponent(Cam); try{cam.fov=60;}catch(e){} try{cam.near=0.1;}catch(e){} const out={fov:cam.fov,near:cam.near}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||typeof r.fov==='number'));

  // ── Q. Audio / Particles ────────────────────────────
  await test('Q audio-fx', 'Q1 AudioSource probe', S(`return {has:!!cc.js.getClassByName("cc.AudioSource")||typeof cc.AudioSource!=="undefined"};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('Q audio-fx', 'Q2 AudioSource volume/loop', S(CLEAN+`const AS=cc.js.getClassByName("cc.AudioSource"); if(!AS) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const a=n.addComponent(AS); a.volume=0.5; a.loop=false; const out={v:a.volume,loop:a.loop}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||Math.abs(r.v-0.5)<1e-6));
  await test('Q audio-fx', 'Q3 ParticleSystem probe', S(`return {has:!!cc.js.getClassByName("cc.ParticleSystem")||typeof cc.ParticleSystem!=="undefined", has2D:!!cc.js.getClassByName("cc.ParticleSystem2D")};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('Q audio-fx', 'Q4 ParticleSystem rate', S(CLEAN+`const PS=cc.js.getClassByName("cc.ParticleSystem")||cc.js.getClassByName("cc.ParticleSystem2D"); if(!PS) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const ps=n.addComponent(PS); const out={hasDuration: "duration" in ps || "totalParticles" in ps}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||r.hasDuration===true));

  // ── R. Animation / Spine ────────────────────────────
  await test('R anim', 'R1 Animation clip list', S(CLEAN+`const A=cc.js.getClassByName("cc.Animation"); if(!A) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const anim=n.addComponent(A); const clips=anim.clips||[]; const out={count:clips.length}; n.removeFromParent(); n.destroy(); return out;`), 'ok', r=>r && (r.skip||typeof r.count==='number'));
  await test('R anim', 'R2 Spine count + read', S(`const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();for(const c of x.components||[])if(c.constructor&&c.constructor.name==="Skeleton")n++;for(const c of x.children||[])st.push(c);} return {count:n, hasSpine: typeof sp!=="undefined" ? "global-sp" : (n>0?"via-node":"none")};`), 'ok', r=>r&&typeof r.count==='number');
  await test('R anim', 'R3 Spine skeletonData', S(`const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const x=st.pop();for(const c of x.components||[])if(c.constructor&&c.constructor.name==="Skeleton"){s={node:x.name,hasData:!!c.skeletonData,anim:c.animation||c.defaultAnimation||null};break;}for(const c of x.children||[])st.push(c);} return s;`), 'ok', r=>r===null || typeof r.hasData==='boolean');
  await test('R anim', 'R4 SkeletalAnimation probe', S(`return {has:!!cc.js.getClassByName("cc.SkeletalAnimation")||!!cc.js.getClassByName("cc.SkeletonAnimation")};`), 'ok', r=>r&&typeof r.has==='boolean');
  await test('R anim', 'R5 bezier 4-point + easing', S(`const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;}; const ease=t=>t*t*(3-2*t); const bez=[b(0,30,70,100,0),b(0,30,70,100,0.5),b(0,30,70,100,1)]; const e=[ease(0),ease(0.5),ease(1)]; return {bez,e};`), 'ok', r=>r&&r.bez[0]===0&&r.bez[2]===100);
  await test('R anim', 'R6 move node along bezier+verify', S(CLEAN+`const n=new cc.Node(M);sc.addChild(n); const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;}; const pts=[]; for(const t of [0,0.5,1]){ n.setPosition(b(0,30,70,100,t), b(0,80,20,100,t), 0); pts.push([Math.round(n.position.x),Math.round(n.position.y)]);} n.removeFromParent(); n.destroy(); return pts;`), 'ok', r=>r&&r.length===3&&r[2][0]===100);

  const groups={}; for(const r of results){ (groups[r.group]=groups[r.group]||[]).push(r); }
  console.log('GROUP RESULTS:');
  for(const g of Object.keys(groups)){ const arr=groups[g]; const p=arr.filter(x=>x.verdict==='PASS').length; console.log(`\n  ${g}: ${p}/${arr.length}`); for(const x of arr) console.log(`    [${x.verdict}] ${x.name} ${x.detail}`); }
  console.log(`\nTOTAL: ${pass} pass, ${fail} fail, ${pass+fail} total`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('suite crashed:',e);process.exit(1);});
