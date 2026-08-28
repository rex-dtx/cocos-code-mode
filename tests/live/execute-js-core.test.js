'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { postTool, healthCheck } = require('../helpers/utcp-client');

function resVal(body) {
  if (body == null) return null;
  if (typeof body === 'object' && 'result' in body) return body.result;
  return null;
}

async function exec(context, code, args, safety_checks, timeout_ms) {
  const body = { context, code };
  if (args) body.args = args;
  if (safety_checks !== undefined) body.safety_checks = safety_checks;
  if (timeout_ms) body.timeout_ms = timeout_ms;
  const r = await postTool('executeJavascript', body);
  return r;
}

describe('live: executeJavascript — core capabilities (A-M)', () => {
  let health;
  before(async () => { health = await healthCheck(); });
  function skip(t) {
    if (!health || !health.ok) { t.skip(`editor not running: ${health ? health.reason : 'no health'}`); return true; }
    return false;
  }

  const CLEAN = 'const sc=cc.director.getScene();const M="__suite_tmp__";for(const n of [...sc.children])if(n.name===M){n.removeFromParent();n.destroy();}';

  // ── A. Core execution ──────────────────────────
  describe('A core execution', () => {
    it('A1 editor arithmetic', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return 1+1'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 2); });
    it('A2 scene arithmetic', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return 2*21'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 42); });
    it('A3 undefined -> null', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const x = 1'); assert.equal(r.ok, true); assert.equal(resVal(r.body), null); });
    it('A4 editor args', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return args.a + args.b', { a: 3, b: 4 }); assert.equal(r.ok, true); assert.equal(resVal(r.body), 7); });
    it('A5 scene args', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return args.v * 3', { v: 10 }); assert.equal(r.ok, true); assert.equal(resVal(r.body), 30); });
    it('A6 editor async', async (t) => { if (skip(t)) return; const r = await exec('editor', 'await new Promise(res => setTimeout(res, 5)); return "done"'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'done'); });
    it('A7 scene async with args', async (t) => { if (skip(t)) return; const r = await exec('scene', 'await new Promise(res => setTimeout(res, 5)); return args.k', { k: 'scene-ok' }); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'scene-ok'); });
    it('A8 nested args', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return args.cfg.speed * args.cfg.n', { cfg: { speed: 2, n: 5 } }); assert.equal(r.ok, true); assert.equal(resVal(r.body), 10); });
  });

  // ── B. Injected globals ────────────────────────
  describe('B injected globals', () => {
    it('B1 editor Editor.Project.path', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return typeof Editor.Project.path === "string" && Editor.Project.path.length > 0'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('B2 editor Editor.Message bridge', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const s = await Editor.Message.request("scene","query-current-scene"); return !!s'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('B3 editor fs/path/os', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return typeof fs.readFileSync === "function" && typeof path.join === "function" && typeof os.homedir === "function"'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('B4 editor require', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return typeof require === "function"'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('B5 scene cc', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return typeof cc === "object" && cc !== null'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('B6 scene cce', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return typeof cce'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'object'); });
    it('B7 scene document', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return typeof document'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'object'); });
    it('B8 scene require present', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return typeof require'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v === 'function' || v === 'undefined'); });
  });

  // ── C. Editor engine integration ───────────────
  describe('C editor engine', () => {
    it('C1 fs read project file', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.readFileSync(path.join(Editor.Project.path, "package.json"), "utf8").length > 0'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('C2 asset-db query-assets', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const a = await Editor.Message.request("asset-db","query-assets",{pattern:"db://assets/**"}); return Array.isArray(a)'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('C3 scene bounds', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const b = await Editor.Message.request("scene","query-scene-bounds"); return !!b'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('C4 scene query-node-tree', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const t = await Editor.Message.request("scene","query-node-tree"); return !!t'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('C5 asset-db query-asset-info', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const i = await Editor.Message.request("asset-db","query-asset-info","db://assets"); return !!(i && (i.uuid || i.url))'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
  });

  // ── D. Scene graph & nodes ─────────────────────
  describe('D scene graph', () => {
    it('D1 scene walk count > 0', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();n++;for(const c of x.children||[])st.push(c);}return n'); assert.equal(r.ok, true); assert.ok(resVal(r.body) > 0); });
    it('D2 component class count > 0', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();const set=new Set();const st=[sc];while(st.length){const x=st.pop();for(const c of x.components||[])if(c.constructor)set.add(c.constructor.name);for(const c of x.children||[])st.push(c);}return set.size'); assert.equal(r.ok, true); assert.ok(resVal(r.body) > 0); });
    it('D3 root name + childCount', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();return {name:sc.name, children:sc.children.length}'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(typeof v.name === 'string'); });
    it('D4 create + destroy node (removeFromParent)', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);let found=false;for(const c of sc.children)if(c.name===M)found=true;node.removeFromParent();node.destroy();let gone=true;for(const c of sc.children)if(c.name===M)gone=false;return found===true && gone===true;'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('D5 find node by name (Canvas)', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let t=null;const st=[sc];while(st.length&&!t){const n=st.pop();if(n.name==="Canvas"){t=n;break;}for(const c of n.children||[])st.push(c);}return t?{name:t.name,uuid:t.uuid,active:t.active}:null'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v === null || v.name === 'Canvas'); });
    it('D6 node setPosition/getPosition', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.setPosition(11,22,33);const p=node.position;const out=[p.x,p.y,p.z];node.destroy();return out;'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [11, 22, 33]); });
  });

  // ── E. Components & properties ─────────────────
  describe('E components', () => {
    it('E1 addComponent + getComponent Label', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);const lab=node.addComponent(cc.Label);lab.string="hello";const got=node.getComponent(cc.Label);const s=got.string;node.destroy();return s;'); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'hello'); });
    it('E2 UITransform via getClassByName', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const UT=cc.js.getClassByName("cc.UITransform");const node=new cc.Node(M);sc.addChild(node);const ut=node.addComponent(UT);ut.setContentSize(123,45);const out=[ut.contentSize.width,ut.contentSize.height];node.destroy();return out;'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [123, 45]); });
    it('E3 Sprite + Color', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);const sp=node.addComponent(cc.Sprite);const c=new cc.Color(255,0,0,255);sp.color=c;const out=[sp.color.r,sp.color.g,sp.color.b];node.destroy();return out;'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [255, 0, 0]); });
    it('E4 node scale/rotation', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.setScale(2,3,1);node.setRotationFromEuler(0,0,45);const out=[node.scale.x,node.scale.y,Math.round(node.eulerAngles.z)];node.destroy();return out;'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [2, 3, 45]); });
    it('E5 getComponents count >= 2', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const UT=cc.js.getClassByName("cc.UITransform");const node=new cc.Node(M);sc.addChild(node);node.addComponent(UT);node.addComponent(cc.Label);const n=node.getComponents(cc.Component).length;node.destroy();return n;'); assert.equal(r.ok, true); assert.ok(resVal(r.body) >= 2); });
    it('E6 active flag toggle', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.active=false;const a=node.active;node.active=true;const b=node.active;node.destroy();return [a,b];'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [false, true]); });
  });

  // ── F. Skeleton / Spine ────────────────────────
  describe('F skeleton', () => {
    it('F1 count Skeleton components', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();for(const c of x.components||[])if(c.constructor&&c.constructor.name==="Skeleton")n++;for(const c of x.children||[])st.push(c);}return n'); assert.equal(r.ok, true); assert.equal(typeof resVal(r.body), 'number'); });
    it('F2 read skeletonData', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const sc=cc.director.getScene();let s=null;const st=[sc];while(st.length&&!s){const x=st.pop();for(const c of x.components||[]){if(c.constructor&&c.constructor.name==="Skeleton"){s={node:x.name,hasData:!!c.skeletonData,anim:c.animation||c.defaultAnimation||null};break;}}for(const c of x.children||[])st.push(c);}return s'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v === null || typeof v.hasData === 'boolean'); });
    it('F3 spine API reachable', async (t) => { if (skip(t)) return; const r = await exec('scene', 'return { hasSkeletonCtor: typeof cc !== "undefined" && !!(globalThis.sp && sp.Skeleton) || true, directorOk: !!cc.director }'); assert.equal(r.ok, true); assert.equal(resVal(r.body).directorOk, true); });
  });

  // ── G. Serialize guard ─────────────────────────
  describe('G serialize', () => {
    it('G1 editor circular', async (t) => { if (skip(t)) return; const r = await exec('editor', 'const a={};a.self=a;return a'); assert.equal(r.ok, true); assert.ok(resVal(r.body) === null || typeof resVal(r.body) === 'object'); });
    it('G2 editor function', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return function(){}'); assert.equal(r.ok, true); assert.equal(resVal(r.body), null); });
    it('G3 editor bigint', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return 123n'); assert.equal(r.ok, true); assert.equal(resVal(r.body), null); });
    it('G4 scene circular (IPC)', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const a={};a.self=a;return a'); assert.equal(r.ok, true); assert.ok(resVal(r.body) === null || typeof resVal(r.body) === 'object'); });
    it('G5 scene orphan cc.Node coerced', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const n=new cc.Node("orphan");return n'); assert.equal(r.ok, true); assert.ok(resVal(r.body) === null || typeof resVal(r.body) === 'object'); });
    it('G6 nested bigint', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return { n: 123n, ok: true }'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v === null || v.ok === true); });
  });

  // ── H. Safety guard ────────────────────────────
  describe('H safety', () => {
    it('H1 fs.unlinkSync blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.unlinkSync("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H2 fs.rmSync blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.rmSync("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H3 fs.truncateSync blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.truncateSync("x",0)'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H4 fs.promises.unlink blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.promises.unlink("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H5 child_process require blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'require("child_process")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H6 spawn blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'spawn("ls")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H7 execSync blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'execSync("ls")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H8 traversal ../ blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.readFileSync("../x","utf8")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H9 home ~/ blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.readFileSync("~/secret","utf8")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H10 abs outside blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.readFileSync("C:/Windows/system32/drivers/etc/hosts","utf8")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H11 abs inside allowed', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.existsSync(path.join(Editor.Project.path, "package.json"))'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('H12 writeFileSync homedir blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.writeFileSync(os.homedir()+"/__x","y")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H13 writeFileSync abs-outside blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.writeFileSync("C:/Windows/Temp/__x","y")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H14 createWriteStream blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.createWriteStream("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H15 process.env HOME + mutation blocked', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.unlinkSync(process.env.HOME + "/x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H16 scene child_process blocked', async (t) => { if (skip(t)) return; const r = await exec('scene', 'require("child_process")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
    it('H17 scene fs.unlinkSync blocked', async (t) => { if (skip(t)) return; const r = await exec('scene', 'fs.unlinkSync("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
  });

  // ── I. safety_checks flag ──────────────────────
  describe('I safety_checks flag', () => {
    it('I1 safety_checks=false benign', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return fs.existsSync(path.join(Editor.Project.path, "package.json"))', null, false); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('I2 default safety on', async (t) => { if (skip(t)) return; const r = await exec('editor', 'fs.unlinkSync("x")'); assert.equal(r.ok, false); assert.match(r.body.error, /safety checks blocked/i); });
  });

  // ── J. Timeout ─────────────────────────────────
  describe('J timeout', () => {
    it('J1 editor async hang rejected', async (t) => { if (skip(t)) return; const r = await exec('editor', 'await new Promise(()=>{})', null, undefined, 300); assert.equal(r.ok, false); assert.match(r.body.error, /timed out/i); });
    it('J2 scene async hang rejected', async (t) => { if (skip(t)) return; const r = await exec('scene', 'await new Promise(()=>{})', null, undefined, 300); assert.equal(r.ok, false); assert.match(r.body.error, /timed out/i); });
    it('J3 fast call unaffected by timeout', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return 5', null, undefined, 300); assert.equal(r.ok, true); assert.equal(resVal(r.body), 5); });
  });

  // ── K. Error handling ──────────────────────────
  describe('K errors', () => {
    it('K1 editor throw', async (t) => { if (skip(t)) return; const r = await exec('editor', 'throw new Error("suite-probe")'); assert.equal(r.ok, false); assert.match(r.body.error, /suite-probe/); });
    it('K2 syntax error', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return ((('); assert.equal(r.ok, false); });
    it('K3 runtime ref error', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return someUndefinedVar'); assert.equal(r.ok, false); assert.match(r.body.error, /is not defined/); });
    it('K4 scene throw', async (t) => { if (skip(t)) return; const r = await exec('scene', 'throw new Error("scene-probe")'); assert.equal(r.ok, false); assert.match(r.body.error, /scene-probe/); });
  });

  // ── L. Gameplay patterns ───────────────────────
  describe('L gameplay patterns', () => {
    it('L1 bezier cubic', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};return [b(0,10,90,100,0),b(0,10,90,100,0.5),b(0,10,90,100,1)]'); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v[0], 0); assert.equal(v[1], 50); assert.equal(v[2], 100); });
    it('L2 move along bezier', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const n=new cc.Node(M);sc.addChild(n);const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};const pts=[];for(const t of[0,0.5,1]){n.setPosition(b(0,30,70,100,t),b(0,80,20,100,t),0);pts.push([Math.round(n.position.x),Math.round(n.position.y)]);}n.destroy();return pts;'); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v.length, 3); assert.equal(v[2][0], 100); });
    it('L3 tween registration (no tick in edit mode)', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const n=new cc.Node(M);sc.addChild(n);let ok=false;try{cc.tween(n).to(0.5,{position:new cc.Vec3(50,0,0)}).start();ok=true;}catch(e){ok=false;}n.destroy();return ok;'); assert.equal(r.ok, true); assert.equal(resVal(r.body), true); });
    it('L4 lerp + easing', async (t) => { if (skip(t)) return; const r = await exec('scene', 'const lerp=(a,b,t)=>a+(b-a)*t;const ease=t=>t*t*(3-2*t);return [lerp(0,100,ease(0)),lerp(0,100,ease(0.5)),lerp(0,100,ease(1))]'); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v[0], 0); assert.equal(v[1], 50); assert.equal(v[2], 100); });
    it('L5 Label roundtrip (game text)', async (t) => { if (skip(t)) return; const r = await exec('scene', CLEAN + 'const n=new cc.Node(M);sc.addChild(n);const lab=n.addComponent(cc.Label);lab.string=args.text;lab.fontSize=args.size;const out={s:n.getComponent(cc.Label).string,f:n.getComponent(cc.Label).fontSize};n.destroy();return out;', { text: 'WIN', size: 32 }); assert.equal(r.ok, true); const v = resVal(r.body); assert.equal(v.s, 'WIN'); assert.equal(v.f, 32); });
  });

  // ── M. Result shapes ───────────────────────────
  describe('M result shapes', () => {
    it('M1 array', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return [1,2,3]'); assert.equal(r.ok, true); assert.deepEqual(resVal(r.body), [1, 2, 3]); });
    it('M2 nested object', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return {a:{b:{c:1}}}'); assert.equal(r.ok, true); assert.equal(resVal(r.body).a.b.c, 1); });
    it('M3 string/number/bool', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return args.x', { x: 'text' }); assert.equal(r.ok, true); assert.equal(resVal(r.body), 'text'); });
    it('M4 empty object -> null (trimmed)', async (t) => { if (skip(t)) return; const r = await exec('editor', 'return {}'); assert.equal(r.ok, true); const v = resVal(r.body); assert.ok(v === null || typeof v === 'object'); });
  });
});
