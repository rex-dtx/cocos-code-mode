'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const gate = path.join(root, 'scripts/check-creator-load.js');

it('all extension entrypoints and compiled modules pass Creator loader gate', () => {
  const output = execFileSync(process.execPath, [gate], { cwd: root, encoding: 'utf8' });
  assert.match(output, /CREATOR_LOAD_OK/);
});

it('gate rejects a dual-package ESM sibling hidden behind a valid CommonJS entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-loader-regression-'));
  try {
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.mkdirSync(path.join(dir, 'node_modules/dual'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: './dist/main.js' }));
    fs.writeFileSync(path.join(dir, 'dist/main.js'), "module.exports = require('dual');");
    fs.writeFileSync(path.join(dir, 'node_modules/dual/package.json'), JSON.stringify({ name: 'dual', type: 'module', main: './index.cjs' }));
    fs.writeFileSync(path.join(dir, 'node_modules/dual/index.cjs'), 'module.exports = { valid: true };');
    fs.writeFileSync(path.join(dir, 'node_modules/dual/index.js'), 'export const valid = true;');
    // Ordinary Node succeeds: the regression is specifically the Creator loader.
    execFileSync(process.execPath, ['-e', 'require(process.argv[1])', path.join(dir, 'dist/main.js')]);
    const failed = spawnSync(process.execPath, [gate, dir], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /CREATOR_LOAD_FAILED/);
    assert.match(failed.stderr, /Unexpected token 'export'/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
