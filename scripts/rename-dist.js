'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

const dist = path.join(__dirname, '..', 'dist');

// Creator loads these by hard path — must NOT rename.
const KEEP = new Set([
  'main.js',
  'scene.js',
  'build-info.js',
  'build-info.json',
  path.join('panels', 'configuration', 'index.js'),
  path.join('panels', 'preview', 'index.js'),
]);

function walk(dir, rel, files) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walk(abs, r, files);
    else if (e.name.endsWith('.js')) files.push({ abs, rel: r.split(path.sep).join('/') });
  }
}

function shortHash(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

function main() {
  if (!fs.existsSync(dist)) throw new Error('dist/ missing — run build:release first');
  const all = [];
  walk(dist, '', all);
  const toRename = all.filter((f) => !KEEP.has(f.rel));
  if (toRename.length === 0) { console.log('rename-dist: nothing to rename'); return; }

  // deterministic mapping: dir kept, basename -> hash.js
  const map = new Map(); // old rel -> new rel
  const used = new Set(KEEP);
  for (const f of toRename) {
    const dir = path.posix.dirname(f.rel);
    let h = shortHash(f.rel);
    let candidate = (dir === '.' ? '' : dir + '/') + h + '.js';
    // avoid collision on same dir
    let i = 0;
    while (used.has(candidate) || [...map.values()].includes(candidate)) {
      candidate = (dir === '.' ? '' : dir + '/') + h + '_' + (i++).toString(16) + '.js';
    }
    used.add(candidate);
    map.set(f.rel, candidate);
  }

  // build require rewrite: for each file, map relative require targets
  // We rewrite after renaming by reading every (kept + renamed) file and patching string literals.
  // Only patch relative requires: require("./foo") / require("../bar")
  const allAfter = new Set([...KEEP, ...map.values()]);
  // Physically rename first
  for (const f of toRename) {
    const src = path.join(dist, f.rel);
    const dst = path.join(dist, map.get(f.rel));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }
  // Remove empty dirs left behind (optional)
  // Rewrite requires in every remaining js file
  const rewritten = [];
  for (const rel of allAfter) {
    if (!rel.endsWith('.js')) continue;
    const abs = path.join(dist, rel);
    if (!fs.existsSync(abs)) continue;
    let code = fs.readFileSync(abs, 'utf8');
    let changed = false;
    // Match require("...") and require('...') and from "..."
    code = code.replace(/require\s*\(\s*(["'])(\.\.?\/[^"']+)\1\s*\)/g, (m, q, reqPath) => {
      // resolve reqPath relative to this file's dir
      const dir = path.posix.dirname(rel);
      const targetNoExt = path.posix.join(dir, reqPath);
      // try with .js appended
      const candidates = [targetNoExt, targetNoExt + '.js', targetNoExt + '/index.js'];
      for (const c of candidates) {
        if (map.has(c)) {
          const newAbs = map.get(c);
          let newRel = path.posix.relative(dir, newAbs);
          if (!newRel.startsWith('.')) newRel = './' + newRel;
          newRel = newRel.replace(/\.js$/, ''); // keep original style: require without ext if original had no ext
          // preserve whether original had .js
          const origHasJs = reqPath.endsWith('.js');
          if (origHasJs && !newRel.endsWith('.js')) newRel += '.js';
          changed = true;
          return `require(${q}${newRel}${q})`;
        }
      }
      return m;
    });
    // also handle import ... from "..." (unlikely in CJS dist but safe)
    code = code.replace(/from\s+(["'])(\.\.?\/[^"']+)\1/g, (m, q, reqPath) => {
      const dir = path.posix.dirname(rel);
      const targetNoExt = path.posix.join(dir, reqPath);
      const candidates = [targetNoExt, targetNoExt + '.js', targetNoExt + '/index.js'];
      for (const c of candidates) {
        if (map.has(c)) {
          const newAbs = map.get(c);
          let newRel = path.posix.relative(dir, newAbs);
          if (!newRel.startsWith('.')) newRel = './' + newRel;
          const origHasJs = reqPath.endsWith('.js');
          if (origHasJs && !newRel.endsWith('.js')) newRel += '.js';
          if (!origHasJs && newRel.endsWith('.js')) newRel = newRel.slice(0, -3);
          changed = true;
          return `from ${q}${newRel}${q}`;
        }
      }
      return m;
    });
    if (changed) { fs.writeFileSync(abs, code); rewritten.push(rel); }
  }

  // Persist map outside ZIP for support debugging — gitignored
  const mapPath = path.join(dist, '.rename-map.json');
  fs.writeFileSync(mapPath, JSON.stringify(Object.fromEntries(map), null, 2));
  console.log(`rename-dist: renamed ${map.size} files, patched ${rewritten.length} files`);
  console.log(`rename-dist: map at dist/.rename-map.json (not packaged)`);
}

main();
