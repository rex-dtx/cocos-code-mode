'use strict';

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const dist = path.join(__dirname, '..', 'dist');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

async function main() {
  if (!fs.existsSync(dist)) throw new Error('dist/ missing — run build:release first');
  const files = walk(dist);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const result = await minify(source, {
      compress: {
        dead_code: true,
        drop_debugger: true,
        evaluate: true,
        passes: 2,
      },
      mangle: {
        toplevel: true,
        reserved: ['load', 'unload', 'methods', 'Editor', 'module', 'exports', 'require'],
      },
      format: {
        comments: false,
        ecma: 2017,
        wrap_iife: true,
      },
      module: false,
      ecma: 2017,
    });
    if (!result.code) throw new Error(`terser produced empty output: ${file}`);
    if (/\beval\s*\(|new Function\s*\(/.test(result.code)) {
      throw new Error(`minify introduced eval/Function: ${file}`);
    }
    fs.writeFileSync(file, result.code);
  }
  console.log(`obfuscate-dist: minified ${files.length} files (mangle+compress, no eval)`);
}

main().catch((error) => {
  console.error(`obfuscate-dist failed: ${error.message}`);
  process.exitCode = 1;
});
