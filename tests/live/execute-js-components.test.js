'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck, resVal } = require('../helpers/utcp-client');

async function exec(context, code, args, safety_checks, timeout_ms) {
  const body = { context, code };
  if (args) body.args = args;
  if (safety_checks !== undefined) body.safety_checks = safety_checks;
  if (timeout_ms) body.timeout_ms = timeout_ms;
  return postTool('executeJavascript', body);
}

describe('live: executeJavascript — Creator 2.4 component families', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  function skip(t) {
    if (!health || !health.ok) { t.skip(`editor not running: ${health ? health.reason : 'no health'}`); return true; }
    if (!health.hasExec) { t.skip('executeJavascript not in /utcp manual'); return true; }
    return false;
  }
  const CLEAN = 'const sc=cc.director.getScene();const M="__v24_tmp__";const kids=sc.children?sc.children.slice():[];for(const n of kids)if(n.name===M){n.removeFromParent();n.destroy();}';
  function CC(name) { return `(cc["${name}"]||cc.js.getClassByName("cc.${name}")||cc.js.getClassByName("${name}"))`; }

  describe('N UI components', () => {
    it('N1 Label string/fontSize', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const Label=${CC('Label')}; if(!Label) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const lab=n.addComponent(Label); lab.string="WIN"; lab.fontSize=32; const out={s:n.getComponent(Label).string,f:n.getComponent(Label).fontSize}; n.removeFromParent(); n.destroy(); return out;`); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v && (v.skip || v.s === 'WIN')); });
    it('N2 RichText', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const RT=${CC('RichText')}; if(!RT) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const rt=n.addComponent(RT); rt.string="<color=#ff0000>hi</color>"; const s=n.getComponent(RT).string; n.removeFromParent(); n.destroy(); return {s};`); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v && (v.skip || !!v.s)); });
    it('N3 Sprite node color', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const n=new cc.Node(M);sc.addChild(n); const sp=n.addComponent(cc.Sprite); const c=new cc.Color(10,20,30,255); n.color=c; const out=[n.color.r,n.color.g,n.color.b]; n.removeFromParent(); n.destroy(); return out;'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v && (v.skip || v[0] === 10)); });
    it('N4 Mask type', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const Mask=${CC('Mask')}; if(!Mask) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const m=n.addComponent(Mask); const ty=m.type; n.removeFromParent(); n.destroy(); return {type:typeof ty};`); assert.equal(r.ok, true); });
    it('N5 Graphics lineWidth', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const G=${CC('Graphics')}; if(!G) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const g=n.addComponent(G); g.lineWidth=5; g.moveTo(0,0); g.lineTo(10,10); g.stroke(); const ok=g.lineWidth===5; n.removeFromParent(); n.destroy(); return {ok};`); assert.equal(r.ok, true); });
    it('N6 Layout type', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const L=${CC('Layout')}; if(!L) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const lo=n.addComponent(L); const out=lo.type; n.removeFromParent(); n.destroy(); return {out};`); assert.equal(r.ok, true); });
    it('N7 ProgressBar progress', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const PB=${CC('ProgressBar')}; if(!PB) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const pb=n.addComponent(PB); pb.progress=0.75; const v=pb.progress; n.removeFromParent(); n.destroy(); return {v};`); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v.skip || Math.abs(v.v - 0.75) < 1e-6); });
    it('N8 Widget align', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const W=${CC('Widget')}; if(!W) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const w=n.addComponent(W); w.isAlignLeft=true; w.left=10; const out={l:w.isAlignLeft,left:w.left}; n.removeFromParent(); n.destroy(); return out;`); assert.equal(r.ok, true); });
    it('N9 Button probe', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + `const B=${CC('Button')}; if(!B) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const b=n.addComponent(B); const out={has:!!b, interact:b.interactable}; n.removeFromParent(); n.destroy(); return out;`); assert.equal(r.ok, true); });
    it('N10 contentSize 2.4', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const n=new cc.Node(M);sc.addChild(n); n.setContentSize(200,100); const out=[n.width,n.height]; n.removeFromParent(); n.destroy(); return out;'); assert.equal(r.ok, true); const v = resVal(r.body); assert.deepEqual(v, [200, 100]); });
  });

  describe('O physics 2D', () => {
    it('O1 RigidBody probe', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return {has:typeof cc.RigidBody!=="undefined"||!!cc.js.getClassByName("cc.RigidBody")};'); assert.equal(r.ok, true); });
    it('O2 BoxCollider probe', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return {has:!!cc.js.getClassByName("cc.BoxCollider")||typeof cc.BoxCollider!=="undefined"};'); assert.equal(r.ok, true); });
    it('O3 PhysicsManager', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const pm=cc.director.getPhysicsManager ? cc.director.getPhysicsManager() : null; return {has:!!pm};'); assert.equal(r.ok, true); });
  });

  describe('P camera', () => {
    it('P1 Camera probe', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return {has:!!cc.js.getClassByName("cc.Camera")||typeof cc.Camera!=="undefined"};'); assert.equal(r.ok, true); });
    it('P2 Camera zoom', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const Cam=cc.js.getClassByName("cc.Camera")||cc.Camera; if(!Cam) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const cam=n.addComponent(Cam); try{cam.zoomRatio=1;}catch(e){} const out={zoom:cam.zoomRatio}; n.removeFromParent(); n.destroy(); return out;'); assert.equal(r.ok, true); });
  });

  describe('Q audio / particles', () => {
    it('Q1 AudioSource probe', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return {has:!!cc.js.getClassByName("cc.AudioSource")||typeof cc.AudioSource!=="undefined"};'); assert.equal(r.ok, true); });
    it('Q2 ParticleSystem probe', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return {has:!!cc.js.getClassByName("cc.ParticleSystem")||typeof cc.ParticleSystem!=="undefined"};'); assert.equal(r.ok, true); });
  });

  describe('R animation / spine', () => {
    it('R1 Animation clips', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const A=cc.js.getClassByName("cc.Animation"); if(!A) return {skip:true}; const n=new cc.Node(M);sc.addChild(n); const anim=n.addComponent(A); const clips=anim.getClips?anim.getClips():(anim.clips||[]); const out={count:clips.length}; n.removeFromParent(); n.destroy(); return out;'); assert.equal(r.ok, true); });
    it('R2 Spine count', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();for(const c of (x._components||x.components||[]))if(c&&c.constructor&&(c.constructor.name==="Skeleton"||c.constructor.name==="sp.Skeleton"))n++;for(const c of x.children||[])st.push(c);} return {count:n};'); assert.equal(r.ok, true); assert.ok(typeof resVal(r.body).count === 'number'); });
    it('R3 bezier + easing', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;}; const ease=t=>t*t*(3-2*t); const bez=[b(0,30,70,100,0),b(0,30,70,100,0.5),b(0,30,70,100,1)]; const e=[ease(0),ease(0.5),ease(1)]; return {bez,e};'); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v.bez[0], 0); assert.equal(v.bez[2], 100); });
  });

  describe('S gameplay runtime', () => {
    it('S1 engine runtime state', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return { paused: cc.game ? !!cc.game.isPaused && cc.game.isPaused() : null, timeScale: cc.director && cc.director.getScheduler ? cc.director.getScheduler().getTimeScale() : null };'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v.timeScale === null || typeof v.timeScale === 'number'); });
    it('S2 Canvas transform read', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let tg=null;const st=[sc];while(st.length&&!tg){const n=st.pop();if(n.name===args.name){tg=n;break;}for(const c of n.children||[])st.push(c);} if(!tg) return null; return {name:tg.name,pos:[tg.x,tg.y],active:tg.active,childCount:tg.children.length};', { name: 'Canvas' }); assert.equal(r.ok, true); const v = resVal(r.body); if (v === null) { t.skip('Canvas not present'); return; } assert.ok(v.pos.every(Number.isFinite)); });
    it('S3 Color/v2 reachability', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return { hasV2: typeof cc.v2==="function"||typeof cc.Vec2!=="undefined", hasColor: typeof cc.Color!=="undefined", hasTween: typeof cc.tween==="function" };'); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v.hasColor, true); });
  });
});
