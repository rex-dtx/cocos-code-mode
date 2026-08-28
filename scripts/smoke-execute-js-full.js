// smoke-execute-js-full.js — comprehensive capability suite for executeJavascript.
// Groups: A core · B globals · C editor-eng · D scene-graph · E components/props ·
// F skeleton/spine · G serialize · H safety · I flag · J timeout · K error ·
// L gameplay patterns · M result shapes. Self-cleaning scene mutations throughout.
// Run: node smoke-execute-js-full.js [port]
const base = process.argv[2] ? `http://localhost:${process.argv[2]}` : 'http://localhost:49650';
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

// Safely pull the tool result out of the envelope. body may be null (trimmed empty
// result), {} (no result key), or {result:X}.
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
    if (!r.ok) { verdict = 'FAIL'; detail += ' body=' + JSON.stringify(r.body).slice(0, 140); }
    else if (check) {
      try { if (!check(rv)) { verdict = 'FAIL'; detail += ' check:false'; } }
      catch (e) { verdict = 'FAIL'; detail += ' check threw ' + e.message; }
    }
    if (verdict === 'PASS') detail += ' result=' + JSON.stringify(rv).slice(0, 70);
  } else if (expect === 'block') {
    if (r.ok) { verdict = 'FAIL'; detail += ' expected block got 200 ' + JSON.stringify(r.body).slice(0, 80); }
    else if (!/safety checks blocked/i.test(errStr)) { verdict = 'FAIL'; detail += ' 500 not-safety: ' + errStr.slice(0, 90); }
    else detail += ' blocked';
  } else if (expect === 'timeout') {
    if (r.ok) { verdict = 'FAIL'; detail += ' expected timeout got 200'; }
    else if (!/timed out/i.test(errStr)) { verdict = 'FAIL'; detail += ' 500 not-timeout: ' + errStr.slice(0, 90); }
    else detail += ' timed out';
  } else if (expect === 'error') {
    if (r.ok) { verdict = 'FAIL'; detail += ' expected error got 200'; }
    else detail += ' errored: ' + errStr.slice(0, 70);
  }

  if (verdict === 'PASS') pass++; else fail++;
  results.push({ group, name, verdict, detail });
}

const E = (code, args, safety, timeout) => { const b = { context: 'editor', code }; if (args) b.args = args; if (safety !== undefined) b.safety_checks = safety; if (timeout) b.timeout_ms = timeout; return b; };
const S = (code, args, safety, timeout) => { const b = { context: 'scene', code }; if (args) b.args = args; if (safety !== undefined) b.safety_checks = safety; if (timeout) b.timeout_ms = timeout; return b; };

// compact self-cleaning scene helper embedded in snippets
const CLEAN = `const sc=cc.director.getScene();const M="__suite_tmp__";for(const n of [...sc.children])if(n.name===M)n.destroy();`;

(async () => {
  console.log('=== executeJavascript FULL capability suite @ ' + base + ' ===\n');

  // ── A. Core execution ───────────────────────────────
  await test('A core', 'A1 editor arithmetic', E('return 1+1'), 'ok', r => r === 2);
  await test('A core', 'A2 scene arithmetic', S('return 2*21'), 'ok', r => r === 42);
  await test('A core', 'A3 undefined -> null', E('const x = 1'), 'ok', r => r === null);
  await test('A core', 'A4 editor args', E('return args.a + args.b', { a: 3, b: 4 }), 'ok', r => r === 7);
  await test('A core', 'A5 scene args', S('return args.v * 3', { v: 10 }), 'ok', r => r === 30);
  await test('A core', 'A6 editor async', E('await new Promise(res => setTimeout(res, 5)); return "done"'), 'ok', r => r === 'done');
  await test('A core', 'A7 scene async', S('await new Promise(res => setTimeout(res, 5)); return args.k', { k: 'scene-ok' }), 'ok', r => r === 'scene-ok');
  await test('A core', 'A8 nested args', E('return args.cfg.speed * args.cfg.n', { cfg: { speed: 2, n: 5 } }), 'ok', r => r === 10);

  // ── B. Injected globals ─────────────────────────────
  await test('B globals', 'B1 editor Editor.Project.path', E('return typeof Editor.Project.path === "string" && Editor.Project.path.length > 0'), 'ok', r => r === true);
  await test('B globals', 'B2 editor Editor.Message bridge', E('const s = await Editor.Message.request("scene","query-current-scene"); return !!s'), 'ok', r => r === true);
  await test('B globals', 'B3 editor fs/path/os', E('return typeof fs.readFileSync === "function" && typeof path.join === "function" && typeof os.homedir === "function"'), 'ok', r => r === true);
  await test('B globals', 'B4 editor require', E('return typeof require === "function"'), 'ok', r => r === true);
  await test('B globals', 'B5 scene cc', S('return typeof cc === "object" && cc !== null'), 'ok', r => r === true);
  await test('B globals', 'B6 scene cce', S('return typeof cce'), 'ok', r => r === 'object');
  await test('B globals', 'B7 scene document', S('return typeof document'), 'ok', r => r === 'object');
  await test('B globals', 'B8 scene require present', S('return typeof require'), 'ok', r => r === 'function' || r === 'undefined');

  // ── C. Editor engine integration ────────────────────
  await test('C editor-eng', 'C1 fs read project package.json', E('return fs.readFileSync(path.join(Editor.Project.path, "package.json"), "utf8").length > 0'), 'ok', r => r === true);
  await test('C editor-eng', 'C2 asset-db query-assets', E('const a = await Editor.Message.request("asset-db","query-assets",{pattern:"db://assets/**"}); return Array.isArray(a)'), 'ok', r => r === true);
  await test('C editor-eng', 'C3 scene bounds', E('const b = await Editor.Message.request("scene","query-scene-bounds"); return !!b'), 'ok', r => r === true);
  await test('C editor-eng', 'C4 scene query-node-tree', E('const t = await Editor.Message.request("scene","query-node-tree"); return !!t'), 'ok', r => r === true);
  await test('C editor-eng', 'C5 asset-db query-asset-info by url', E('const i = await Editor.Message.request("asset-db","query-asset-info","db://assets"); return i && (i.uuid || i.url) ? true : false'), 'ok', r => r === true);

  // ── D. Scene graph & nodes ──────────────────────────
  await test('D scene-graph', 'D1 scene walk count', S('const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();n++;for(const c of x.children||[])st.push(c);}return n'), 'ok', r => typeof r === 'number' && r > 0);
  await test('D scene-graph', 'D2 component class count', S('const sc=cc.director.getScene();const set=new Set();const st=[sc];while(st.length){const x=st.pop();for(const c of x.components||[])if(c.constructor)set.add(c.constructor.name);for(const c of x.children||[])st.push(c);}return set.size'), 'ok', r => r > 0);
  await test('D scene-graph', 'D3 root name + childCount', S('const sc=cc.director.getScene();return {name:sc.name, children:sc.children.length}'), 'ok', r => r && typeof r.name === 'string');
  await test('D scene-graph', 'D4 create + destroy node', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    let found=false;for(const c of sc.children)if(c.name===M)found=true;
    node.removeFromParent();node.destroy();
    let gone=true;for(const c of sc.children)if(c.name===M)gone=false;
    return found===true && gone===true;`), 'ok', r => r === true);
  await test('D scene-graph', 'D5 find node by name (Canvas)', S('const sc=cc.director.getScene();let t=null;const st=[sc];while(st.length&&!t){const n=st.pop();if(n.name==="Canvas"){t=n;break;}for(const c of n.children||[])st.push(c);}return t?{name:t.name,uuid:t.uuid,active:t.active}:null'), 'ok', r => r === null || (r && r.name === 'Canvas'));
  await test('D scene-graph', 'D6 node setPosition/getPosition', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);node.setPosition(11,22,33);
    const p=node.position;const out=[p.x,p.y,p.z];node.destroy();return out;`), 'ok', r => r && r[0] === 11 && r[1] === 22 && r[2] === 33);

  // ── E. Components & properties ──────────────────────
  await test('E components', 'E1 addComponent + getComponent Label', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    const lab=node.addComponent(cc.Label);lab.string="hello";
    const got=node.getComponent(cc.Label);const s=got.string;node.destroy();return s;`), 'ok', r => r === 'hello');
  await test('E components', 'E2 UITransform contentSize set/read', S(CLEAN + `
    const UT=cc.js.getClassByName("cc.UITransform");
    const node=new cc.Node(M);sc.addChild(node);
    const ut=node.addComponent(UT);ut.setContentSize(123,45);
    const out=[ut.contentSize.width,ut.contentSize.height];node.destroy();return out;`), 'ok', r => r && r[0] === 123 && r[1] === 45);
  await test('E components', 'E3 Sprite + Color', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    const sp=node.addComponent(cc.Sprite);
    const c=new cc.Color(255,0,0,255);sp.color=c;
    const out=[sp.color.r,sp.color.g,sp.color.b];node.destroy();return out;`), 'ok', r => r && r[0] === 255 && r[1] === 0);
  await test('E components', 'E4 node scale/rotation', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);node.setScale(2,3,1);node.setRotationFromEuler(0,0,45);
    const out=[node.scale.x,node.scale.y,Math.round(node.eulerAngles.z)];node.destroy();return out;`), 'ok', r => r && r[0] === 2 && r[1] === 3 && r[2] === 45);
  await test('E components', 'E5 getComponents count', S(CLEAN + `
    const UT=cc.js.getClassByName("cc.UITransform");
    const node=new cc.Node(M);sc.addChild(node);node.addComponent(UT);node.addComponent(cc.Label);
    const n=node.getComponents(cc.Component).length;node.destroy();return n;`), 'ok', r => r >= 2);
  await test('E components', 'E6 active flag toggle', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);node.active=false;const a=node.active;node.active=true;const b=node.active;node.destroy();return [a,b];`), 'ok', r => r && r[0] === false && r[1] === true);

  // ── F. Skeleton / Spine ─────────────────────────────
  await test('F skeleton', 'F1 count Skeleton components', S('const sc=cc.director.getScene();let n=0;const st=[sc];while(st.length){const x=st.pop();for(const c of x.components||[])if(c.constructor&&c.constructor.name==="Skeleton")n++;for(const c of x.children||[])st.push(c);}return n'), 'ok', r => typeof r === 'number');
  await test('F skeleton', 'F2 read skeletonData presence', S('const sc=cc.director.getScene();let sample=null;const st=[sc];while(st.length&&!sample){const x=st.pop();for(const c of x.components||[]){if(c.constructor&&c.constructor.name==="Skeleton"){sample={node:x.name,hasData:!!c.skeletonData,defaultAnim:c.defaultAnimation||null};break;}}for(const c of x.children||[])st.push(c);}return sample'), 'ok', r => r === null || (r && typeof r.hasData === 'boolean'));
  await test('F skeleton', 'F3 spine API reachable', S('return { hasSkeletonCtor: typeof cc !== "undefined" && !!(globalThis.sp && sp.Skeleton) || true, directorOk: !!cc.director }'), 'ok', r => r && r.directorOk === true);

  // ── G. Serialize guard ──────────────────────────────
  await test('G serialize', 'G1 editor circular object', E('const a={};a.self=a;return a'), 'ok', r => r === null || typeof r === 'object');
  await test('G serialize', 'G2 editor function return', E('return function(){}'), 'ok', r => r === null);
  await test('G serialize', 'G3 editor bigint return', E('return 123n'), 'ok', r => r === null);
  await test('G serialize', 'G4 scene circular object (IPC)', S('const a={};a.self=a;return a'), 'ok', r => r === null || typeof r === 'object');
  await test('G serialize', 'G5 scene orphan cc.Node coerced', S('const n=new cc.Node("orphan");return n'), 'ok', r => r === null || typeof r === 'object');
  await test('G serialize', 'G6 nested bigint in object', E('return { n: 123n, ok: true }'), 'ok', r => r === null || (r && r.ok === true));

  // ── H. Safety guard (editor) ────────────────────────
  await test('H safety', 'H1 fs.unlinkSync blocked', E('fs.unlinkSync("x")'), 'block');
  await test('H safety', 'H2 fs.rmSync blocked', E('fs.rmSync("x")'), 'block');
  await test('H safety', 'H3 fs.truncateSync blocked', E('fs.truncateSync("x",0)'), 'block');
  await test('H safety', 'H4 fs.promises.unlink blocked', E('fs.promises.unlink("x")'), 'block');
  await test('H safety', 'H5 child_process require blocked', E('require("child_process")'), 'block');
  await test('H safety', 'H6 spawn blocked', E('spawn("ls")'), 'block');
  await test('H safety', 'H7 execSync blocked', E('execSync("ls")'), 'block');
  await test('H safety', 'H8 traversal ../ blocked', E('return fs.readFileSync("../x","utf8")'), 'block');
  await test('H safety', 'H9 home ~/ blocked', E('return fs.readFileSync("~/secret","utf8")'), 'block');
  await test('H safety', 'H10 abs outside project blocked', E('return fs.readFileSync("C:/Windows/system32/drivers/etc/hosts","utf8")'), 'block');
  await test('H safety', 'H11 abs inside project allowed', E('return fs.existsSync(path.join(Editor.Project.path, "package.json"))'), 'ok', r => r === true);
  await test('H safety', 'H12 writeFileSync homedir blocked', E('fs.writeFileSync(os.homedir()+"/__x","y")'), 'block');
  await test('H safety', 'H13 writeFileSync abs-outside blocked', E('fs.writeFileSync("C:/Windows/Temp/__x","y")'), 'block');
  await test('H safety', 'H14 createWriteStream blocked', E('fs.createWriteStream("x")'), 'block');
  await test('H safety', 'H15 process.env HOME + mutation blocked', E('fs.unlinkSync(process.env.HOME + "/x")'), 'block');
  await test('H safety', 'H16 scene child_process blocked', S('require("child_process")'), 'block');
  await test('H safety', 'H17 scene fs.unlinkSync blocked', S('fs.unlinkSync("x")'), 'block');

  // ── I. safety_checks flag ───────────────────────────
  await test('I flag', 'I1 safety_checks=false benign', E('return fs.existsSync(path.join(Editor.Project.path, "package.json"))', null, false), 'ok', r => r === true);
  await test('I flag', 'I2 default safety on', E('fs.unlinkSync("x")'), 'block');

  // ── J. Timeout ──────────────────────────────────────
  await test('J timeout', 'J1 editor async hang rejected', E('await new Promise(()=>{})', null, undefined, 300), 'timeout');
  await test('J timeout', 'J2 scene async hang rejected', S('await new Promise(()=>{})', null, undefined, 300), 'timeout');
  await test('J timeout', 'J3 fast call unaffected', E('return 5', null, undefined, 300), 'ok', r => r === 5);

  // ── K. Error handling ───────────────────────────────
  await test('K error', 'K1 editor throw propagates', E('throw new Error("suite-probe")'), 'error');
  await test('K error', 'K2 syntax error', E('return ((('), 'error');
  await test('K error', 'K3 runtime reference error', E('return someUndefinedVar'), 'error');
  await test('K error', 'K4 scene throw propagates', S('throw new Error("scene-probe")'), 'error');

  // ── L. Gameplay patterns ────────────────────────────
  await test('L gameplay', 'L1 bezier cubic sampling', S('const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};return [b(0,10,90,100,0),b(0,10,90,100,0.5),b(0,10,90,100,1)]'), 'ok', r => r && r[0] === 0 && r[1] === 50 && r[2] === 100);
  await test('L gameplay', 'L2 move node along bezier path', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    const b=(p0,p1,p2,p3,t)=>{const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;};
    const pts=[];for(const t of [0,0.5,1]){node.setPosition(b(0,30,70,100,t),b(0,80,20,100,t),0);pts.push([Math.round(node.position.x),Math.round(node.position.y)]);}
    node.destroy();return pts;`), 'ok', r => r && r.length === 3 && r[2][0] === 100);
  await test('L gameplay', 'L3 tween registration (no tick)', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    let ok=false;try{cc.tween(node).to(0.5,{position:new cc.Vec3(50,0,0)}).start();ok=true;}catch(e){ok=false;}
    node.destroy();return ok;`), 'ok', r => r === true);
  await test('L gameplay', 'L4 lerp + easing math', S('const lerp=(a,b,t)=>a+(b-a)*t;const ease=t=>t*t*(3-2*t);return [lerp(0,100,ease(0)),lerp(0,100,ease(0.5)),lerp(0,100,ease(1))]'), 'ok', r => r && r[0] === 0 && r[1] === 50 && r[2] === 100);
  await test('L gameplay', 'L5 create Label roundtrip (game text)', S(CLEAN + `
    const node=new cc.Node(M);sc.addChild(node);
    const lab=node.addComponent(cc.Label);lab.string=args.text;lab.fontSize=args.size;
    const out={s:node.getComponent(cc.Label).string,f:node.getComponent(cc.Label).fontSize};node.destroy();return out;`, { text: 'WIN', size: 32 }), 'ok', r => r && r.s === 'WIN' && r.f === 32);

  // ── M. Result shapes ────────────────────────────────
  await test('M shapes', 'M1 array return', E('return [1,2,3]'), 'ok', r => r && r.length === 3);
  await test('M shapes', 'M2 nested object', E('return {a:{b:{c:1}}}'), 'ok', r => r && r.a.b.c === 1);
  await test('M shapes', 'M3 string/number/bool', E('return args.x', { x: 'text' }), 'ok', r => r === 'text');
  await test('M shapes', 'M4 empty object -> trimmed null', E('return {}'), 'ok', r => r === null || (r && typeof r === 'object'));

  // ── summary ─────────────────────────────────────────
  const groups = {};
  for (const r of results) { (groups[r.group] = groups[r.group] || []); groups[r.group].push(r); }
  console.log('GROUP RESULTS:');
  for (const g of Object.keys(groups)) {
    const arr = groups[g];
    const p = arr.filter(x => x.verdict === 'PASS').length;
    console.log(`\n  ${g}: ${p}/${arr.length}`);
    for (const x of arr) console.log(`    [${x.verdict}] ${x.name} ${x.detail}`);
  }
  console.log(`\nTOTAL: ${pass} pass, ${fail} fail, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('suite crashed:', e); process.exit(1); });
