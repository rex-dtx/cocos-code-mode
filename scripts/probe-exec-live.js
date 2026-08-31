const base = 'http://localhost:49650';
async function exec(context, code, args, safety_checks) {
  const body = { context, code };
  if (args) body.args = args;
  if (safety_checks !== undefined) body.safety_checks = safety_checks;
  const t0 = Date.now();
  const r = await fetch(base + '/tools/executeJavascript', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = text; }
  return { ok: r.ok, status: r.status, ms, body: j };
}
function log(name, res) {
  const tag = res.ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name} (${res.ms}ms) status=${res.status}`);
  console.log('  body:', JSON.stringify(res.body).slice(0, 1000));
  console.log();
}
(async () => {
  console.log('=== SMOKE executeJavascript @ ' + base + ' ===\n');
  log('1 editor arithmetic', await exec('editor', 'return 1+1'));
  log('2 editor Editor.Project.path', await exec('editor', 'return Editor.Project.path'));
  log('3 editor args x+y', await exec('editor', 'return args.x + args.y', { x: 10, y: 32 }));
  log('4 editor async Editor.Message query-current-scene', await exec('editor', 'const r = await Editor.Message.request("scene","query-current-scene"); return typeof r === "string" ? r.slice(0,8) : (r && r.uuid ? r.uuid.slice(0,8) : String(r).slice(0,60))'));
  log('5 editor safety block unlink', await exec('editor', 'fs.unlinkSync("x")'));
  log('6 editor safety block traversal ..', await exec('editor', 'return fs.readFileSync("../package.json","utf8").slice(0,20)'));
  log('7 editor safety bypass existsSync project/package.json', await exec('editor', 'return fs.existsSync(path.join(Editor.Project.path, "package.json"))', null, false));
  log('8 editor throw', await exec('editor', 'throw new Error("probe-error")'));
  log('9 scene typeof cc', await exec('scene', 'return typeof cc'));
  log('10 scene cc.director', await exec('scene', 'return cc && cc.director ? "director ok" : "no director"'));
  log('11 scene args a*2', await exec('scene', 'return args.a * 2', { a: 21 }));
  log('12 scene safety child_process', await exec('scene', 'return require("child_process").execSync("echo hi").toString()'));
  log('13 editor fs read inside project', await exec('editor', 'return fs.readFileSync(path.join(Editor.Project.path, "package.json"),"utf8").slice(0,60)'));
})();
