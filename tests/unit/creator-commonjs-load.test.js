'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

it('main and Status panel load under Creator 3.7 sibling-JS preference', () => {
  const script = `
    const Module = require('module'), fs = require('fs'), path = require('path');
    // Creator 3.7 extFunction prefers sibling .js even for a resolved .cjs file.
    Module._extensions['.js'] = (module, filename) => {
      const base = path.basename(filename, path.extname(filename));
      const sibling = path.join(path.dirname(filename), base + '.js');
      const source = fs.existsSync(sibling) ? sibling : filename;
      const text = fs.readFileSync(source, 'utf8');
      new (require('vm').Script)(Module.wrap(text), { filename: source });
      module._compile(text, source);
    };
    global.Editor = { Panel: { define: value => value } };
    Module._extensions['.cjs'] = Module._extensions['.js'];
    const main = require('./dist/main.js');
    const panel = require('./dist/panels/status/index.js');
    if(typeof main.methods.getExtensionStatus !== 'function' || typeof panel.ready !== 'function') throw new Error('Missing public entrypoints');
    main.methods.getExtensionStatus().then(value => {
      if(value.http.status !== 'not-running') throw new Error('Stopped state missing');
      console.log('CREATOR_COMMONJS_LOAD_OK');
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
  assert.match(output, /CREATOR_COMMONJS_LOAD_OK/);
});
