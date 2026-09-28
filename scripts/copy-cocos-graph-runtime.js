'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'tools', 'cocos-graph');
const destination = path.join(root, 'dist', 'cocos-graph');
const sourceDirectory = path.join(source, 'src');

function copyMjsDirectory(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const files = fs.readdirSync(from, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.mjs'))
    .map(entry => entry.name)
    .sort();
  for (const name of files) fs.copyFileSync(path.join(from, name), path.join(to, name));
  return files;
}

function copyCocosGraphRuntime() {
  const worker = path.join(source, 'runtime-worker.mjs');
  if (!fs.statSync(worker).isFile()) throw new Error(`Missing cocos-graph runtime worker: ${worker}`);
  fs.rmSync(destination, { recursive: true, force: true });
  const coreFiles = copyMjsDirectory(sourceDirectory, path.join(destination, 'src'));
  fs.copyFileSync(worker, path.join(destination, 'runtime-worker.mjs'));
  return { coreFiles, worker: 'runtime-worker.mjs' };
}

module.exports = { copyCocosGraphRuntime };
if (require.main === module) {
  try {
    const result = copyCocosGraphRuntime();
    console.log(`[copy:cocos-graph-runtime] copied ${result.coreFiles.length} core modules and ${result.worker}`);
  } catch (error) {
    console.error('[copy:cocos-graph-runtime] FAILED', error.stack || error);
    process.exitCode = 1;
  }
}
