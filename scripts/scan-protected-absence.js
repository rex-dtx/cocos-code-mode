#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const hits = [];
const executeDir = path.join(root, 'utcp', 'execute');
if (fs.existsSync(executeDir)) hits.push('dist/utcp/execute still present');

const forbidden = ['new Function', 'eval('];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.js$/.test(entry.name) && !full.includes(`${path.sep}execute${path.sep}`)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const marker of forbidden) {
        if (text.includes(marker)) hits.push(`${path.relative(root, full)}: ${marker}`);
      }
    }
  }
}
walk(root);
if (hits.length) {
  console.error(JSON.stringify({ ok: false, hits }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, scanned: root }));
