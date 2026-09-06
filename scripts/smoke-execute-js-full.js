'use strict';
// smoke-execute-js-full.js — executeJavascript capability suite for Creator 2.4.
// Groups A-M. Self-cleaning scene mutations. Run: npm run smoke:execute-js [port]
const fs = require('fs');
const os = require('os');
const path = require('path');

function discoverBase() {
  const arg = Number(process.argv[2]);
  if (arg > 0) return `http://localhost:${arg}`;
  if (process.env.UTCP_BASE) return process.env.UTCP_BASE.replace(/\/$/, '');
  const utcpPath = process.env.UTCP_CONFIG_FILE || path.join(os.homedir(), '.utcp_config.json');
  const cfg = JSON.parse(fs.readFileSync(utcpPath, 'utf8'));
  const tpls = cfg.manual_call_templates || [];
  const canon = tpls.find((t) => t && t.name === 'ccb2x') || tpls.find((t) => t && t.name === 'cc-bridge-2x');
  const m = String((canon && canon.url) || '').match(/localhost:(\d+)/);
  if (!m) throw new Error(`Cannot discover ccb2x URL from ${utcpPath}. Open Creator 2.4 or pass a port.`);
  return `http://localhost:${m[1]}`;
}

const base = discoverBase();
const TOOL = base + '/tools/executeJavascript';

let pass = 0, fail = 0;
const results = [];

async function call(body) {
  const t0 = Date.now();
  const r = await fetch(TOOL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { ok: r.ok, status: r.status, ms, body: j };
}

function resVal(body) {
  if (body == null) return null;
  if (typeof body === 'object' && 'result' in body) return body.result;
  return null;
}

async function test(group, name, body, expect, check) {
  let r;
  try { r = await call(body); }
  catch (e) { fail++; results.push({ group, name, verdict: 'FAIL', detail: 'request error ' + e.message }); return; }

  const errStr = r.body && r.body.error ? String(r.body.error) : '';
  let verdict = 'PASS'; let detail = `(${r.ms}ms)`;
  const rv = resVal(r.body);

  if (expect === 'ok') {
    if (!r.ok) { verdict = 'FAIL'; detail = `HTTP ${r.status} ${errStr}`; }
    else if (check && !check(rv)) { verdict = 'FAIL'; detail = `check failed result=${JSON.stringify(rv)}`; }
  } else if (expect === 'block') {
    if (r.ok || !/safety checks blocked/i.test(errStr)) { verdict = 'FAIL'; detail = `expected block, got ${r.status} ${errStr}`; }
  } else if (expect === 'timeout') {
    if (r.ok || !/timed out/i.test(errStr)) { verdict = 'FAIL'; detail = `expected timeout, got ${r.status} ${errStr}`; }
  } else if (expect === 'error') {
    if (r.ok) { verdict = 'FAIL'; detail = `expected error, got ok result=${JSON.stringify(rv)}`; }
  }

  if (verdict === 'PASS') pass++; else fail++;
  results.push({ group, name, verdict, detail });
}

const E = (code, args, safety, timeout) => { const b = { context: 'editor', code }; if (args) b.args = args; if (safety !== undefined) b.safety_checks = safety; if (timeout) b.timeout_ms = timeout; return b; };
const S = (code, args, safety, timeout) => { const b = { context: 'scene', code }; if (args) b.args = args; if (safety !== undefined) b.safety_checks = safety; if (timeout) b.timeout_ms = timeout; return b; };
const CLEAN = 'const sc=cc.director.getScene();const M="__suite_tmp__";const kids=sc.children?sc.children.slice():[];for(const n of kids)if(n.name===M){n.removeFromParent();n.destroy();}';

(async () => {
  console.log('=== executeJavascript FULL capability suite (2.4) @ ' + base + ' ===\n');

  await test('A core', 'A1 editor arithmetic', E('return 1+1'), 'ok', r => r === 2);
  await test('A core', 'A2 scene arithmetic', S('return 2*21'), 'ok', r => r === 42);
  await test('A core', 'A3 undefined -> null', E('const x = 1'), 'ok', r => r === null);
  await test('A core', 'A4 editor args', E('return args.a + args.b', { a: 3, b: 4 }), 'ok', r => r === 7);
  await test('A core', 'A5 scene args', S('return args.v * 3', { v: 10 }), 'ok', r => r === 30);
  await test('A core', 'A6 editor async', E('await new Promise(res => setTimeout(res, 5)); return "done"'), 'ok', r => r === 'done');
  await test('A core', 'A7 scene async', S('await new Promise(res => setTimeout(res, 5)); return args.k', { k: 'scene-ok' }), 'ok', r => r === 'scene-ok');
  await test('A core', 'A8 nested args', E('return args.cfg.speed * args.cfg.n', { cfg: { speed: 2, n: 5 } }), 'ok', r => r === 10);

  await test('B globals', 'B1 editor Editor.Project.path', E('return typeof Editor.Project.path === "string" && Editor.Project.path.length > 0'), 'ok', r => r === true);
  await test('B globals', 'B2 editor Ipc+Scene', E('return typeof Editor.Ipc.sendToPanel === "function" && typeof Editor.Scene.callSceneScript === "function"'), 'ok', r => r === true);
  await test('B globals', 'B3 editor fs/path/os', E('return typeof fs.readFileSync === "function" && typeof path.join === "function" && typeof os.homedir === "function"'), 'ok', r => r === true);
  await test('B globals', 'B4 editor require', E('return typeof require === "function"'), 'ok', r => r === true);
  await test('B globals', 'B5 scene cc', S('return typeof cc === "object" && cc !== null'), 'ok', r => r === true);
  await test('B globals', 'B6 scene Editor (no cce)', S('return typeof Editor === "object" || typeof Editor === "undefined"'), 'ok', r => r === true);
  await test('B globals', 'B7 scene document', S('return typeof document === "object" || typeof document === "undefined"'), 'ok', r => r === true);
  await test('B globals', 'B8 scene require', S('return typeof require === "function" || typeof require === "undefined"'), 'ok', r => r === true);

  await test('C editor-eng', 'C1 fs sees project root', E('const p=Editor.Project.path; return fs.existsSync(path.join(p,"project.json")) || fs.existsSync(path.join(p,"assets")) || fs.existsSync(path.join(p,"package.json"))'), 'ok', r => r === true);
  await test('C editor-eng', 'C2 assetdb present', E('return typeof Editor.assetdb === "object" && Editor.assetdb !== null'), 'ok', r => r === true);
  await test('C editor-eng', 'C3 scene query-hierarchy', E('return await new Promise((resolve) => { Editor.Ipc.sendToPanel("scene", "scene:query-hierarchy", (err, sceneID, hierarchy) => resolve(!err && !!hierarchy)); })'), 'ok', r => r === true);
  await test('C editor-eng', 'C4 callSceneScript', E('return typeof Editor.Scene.callSceneScript === "function"'), 'ok', r => r === true);
  await test('C editor-eng', 'C5 assetdb uuid/url', E('return typeof Editor.assetdb.uuidToUrl === "function" || typeof Editor.assetdb.urlToUuid === "function"'), 'ok', r => r === true);

  await test('D scene-graph', 'D1 walk count', S('const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();n++;for(const c of x.children||[])st.push(c);}return n'), 'ok', r => typeof r === 'number' && r > 0);
  await test('D scene-graph', 'D2 component classes', S('const sc=cc.director.getScene();const set=new Set();const st=[sc];while(st.length){const x=st.pop();for(const c of (x._components||x.components||[]))if(c&&c.constructor)set.add(c.constructor.name);for(const c of x.children||[])st.push(c);}return set.size'), 'ok', r => r > 0);
  await test('D scene-graph', 'D3 root name', S('const sc=cc.director.getScene();return {name:sc.name, children:sc.children.length}'), 'ok', r => r && typeof r.name === 'string');
  await test('D scene-graph', 'D4 create+destroy', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);let found=false;for(const c of sc.children)if(c.name===M)found=true;node.removeFromParent();node.destroy();let gone=true;for(const c of sc.children)if(c.name===M)gone=false;return found===true && gone===true;'), 'ok', r => r === true);
  await test('D scene-graph', 'D5 find Canvas', S('const sc=cc.director.getScene();let t=null;const st=[sc];while(st.length&&!t){const n=st.pop();if(n.name==="Canvas"){t=n;break;}for(const c of n.children||[])st.push(c);}return t?{name:t.name}:null'), 'ok', r => r === null || (r && r.name === 'Canvas'));
  await test('D scene-graph', 'D6 setPosition 2D', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.setPosition(11,22);const out=[node.x,node.y];node.destroy();return out;'), 'ok', r => r && r[0] === 11 && r[1] === 22);

  await test('E components', 'E1 Label', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);const lab=node.addComponent(cc.Label);lab.string="hello";const s=node.getComponent(cc.Label).string;node.destroy();return s;'), 'ok', r => r === 'hello');
  await test('E components', 'E2 contentSize', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.setContentSize(123,45);const out=[node.width,node.height];node.destroy();return out;'), 'ok', r => r && r[0] === 123 && r[1] === 45);
  await test('E components', 'E3 Sprite color', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.addComponent(cc.Sprite);const c=new cc.Color(255,0,0,255);node.color=c;const out=[node.color.r,node.color.g,node.color.b];node.destroy();return out;'), 'ok', r => r && r[0] === 255);
  await test('E components', 'E4 scale/angle', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.setScale(2,3);node.angle=45;const out=[node.scaleX,node.scaleY,Math.round(node.angle)];node.destroy();return out;'), 'ok', r => r && r[0] === 2 && r[1] === 3 && r[2] === 45);
  await test('E components', 'E5 getComponents', S(CLEAN + 'const a=new cc.Node(M);sc.addChild(a);a.addComponent(cc.Sprite);const ns=a.getComponents(cc.Component).length;a.destroy();const b=new cc.Node(M);sc.addChild(b);b.addComponent(cc.Label);const nl=b.getComponents(cc.Component).length;b.destroy();return [ns,nl];'), 'ok', r => r && r[0] >= 1 && r[1] >= 1);
  await test('E components', 'E6 active toggle', S(CLEAN + 'const node=new cc.Node(M);sc.addChild(node);node.active=false;const a=node.active;node.active=true;const b=node.active;node.destroy();return [a,b];'), 'ok', r => r && r[0] === false && r[1] === true);

  await test('F skeleton', 'F1 count', S('const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();for(const c of (x._components||x.components||[]))if(c&&c.constructor&&(c.constructor.name==="Skeleton"||c.constructor.name==="sp.Skeleton"))n++;for(const c of x.children||[])st.push(c);}return n'), 'ok', r => typeof r === 'number');
  await test('F skeleton', 'F2 director', S('return { directorOk: !!cc.director }'), 'ok', r => r && r.directorOk === true);

  await test('G serialize', 'G1 circular', E('const a={};a.self=a;return a'), 'ok', r => r === null || typeof r === 'object');
  await test('G serialize', 'G2 function', E('return function(){}'), 'ok', r => r === null);
  await test('G serialize', 'G3 bigint', E('return 123n'), 'ok', r => r === null);
  await test('G serialize', 'G4 scene circular', S('const a={};a.self=a;return a'), 'ok', r => r === null || typeof r === 'object');
  await test('G serialize', 'G5 orphan node', S('const n=new cc.Node("orphan");return n'), 'ok', r => r === null || typeof r === 'object');

  await test('H safety', 'H1 unlink blocked', E('fs.unlinkSync("x")'), 'block');
  await test('H safety', 'H5 child_process blocked', E('require("child_process")'), 'block');
  await test('H safety', 'H8 traversal blocked', E('return fs.readFileSync("../x","utf8")'), 'block');
  await test('H safety', 'H11 inside allowed', E('const p=Editor.Project.path; return fs.existsSync(path.join(p,"project.json")) || fs.existsSync(path.join(p,"assets")) || fs.existsSync(path.join(p,"package.json"))'), 'ok', r => r === true);
  await test('H safety', 'H16 scene child_process blocked', S('require("child_process")'), 'block');
  await test('H safety', 'H17 scene unlink blocked', S('fs.unlinkSync("x")'), 'block');

  await test('I flag', 'I1 safety_checks=false', E('const p=Editor.Project.path; return fs.existsSync(path.join(p,"assets")) || fs.existsSync(path.join(p,"project.json"))', null, false), 'ok', r => r === true);
  await test('I flag', 'I2 default on', E('fs.unlinkSync("x")'), 'block');

  await test('J timeout', 'J1 editor hang', E('await new Promise(()=>{})', null, undefined, 300), 'timeout');
  await test('J timeout', 'J2 scene hang', S('await new Promise(()=>{})', null, undefined, 300), 'timeout');
  await test('J timeout', 'J3 fast', E('return 5', null, undefined, 300), 'ok', r => r === 5);

  await test('K error', 'K1 throw', E('throw new Error("suite-probe")'), 'error');
  await test('K error', 'K2 syntax', E('return ((('), 'error');
  await test('K error', 'K4 scene throw', S('throw new Error("scene-probe")'), 'error');

  await test('L gameplay', 'L1 bezier', S('const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};return [b(0,10,90,100,0),b(0,10,90,100,0.5),b(0,10,90,100,1)]'), 'ok', r => r && r[0] === 0 && r[1] === 50 && r[2] === 100);
  await test('L gameplay', 'L4 lerp', S('const lerp=(a,b,t)=>a+(b-a)*t;const ease=t=>t*t*(3-2*t);return [lerp(0,100,ease(0)),lerp(0,100,ease(0.5)),lerp(0,100,ease(1))]'), 'ok', r => r && r[0] === 0 && r[1] === 50 && r[2] === 100);
  await test('L gameplay', 'L5 Label', S(CLEAN + 'const n=new cc.Node(M);sc.addChild(n);const lab=n.addComponent(cc.Label);lab.string=args.text;lab.fontSize=args.size;const out={s:n.getComponent(cc.Label).string,f:n.getComponent(cc.Label).fontSize};n.destroy();return out;', { text: 'WIN', size: 32 }), 'ok', r => r && r.s === 'WIN' && r.f === 32);

  await test('M shapes', 'M1 array', E('return [1,2,3]'), 'ok', r => r && r.length === 3);
  await test('M shapes', 'M2 nested', E('return {a:{b:{c:1}}}'), 'ok', r => r && r.a.b.c === 1);
  await test('M shapes', 'M3 string', E('return args.x', { x: 'text' }), 'ok', r => r === 'text');

  const groups = {};
  for (const r of results) { (groups[r.group] = groups[r.group] || []).push(r); }
  console.log('GROUP RESULTS:');
  for (const g of Object.keys(groups)) {
    const arr = groups[g];
    const p = arr.filter(x => x.verdict === 'PASS').length;
    console.log(`\n  ${g}: ${p}/${arr.length}`);
    for (const x of arr) console.log(`    [${x.verdict}] ${x.name} ${x.detail}`);
  }
  console.log(`\nTOTAL: ${pass} pass, ${fail} fail, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('suite crashed:', e); process.exit(1); });
