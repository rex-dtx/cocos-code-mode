'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { inspectJavascriptSafety, assertJavascriptSafety } = requireDist('utcp/execute/javascript-safety.js');
const PROJECT = '/tmp/cc-test-project';

describe('javascript-safety — inspectJavascriptSafety', () => {
  describe('delete/truncate blocked', () => {
    for (const snippet of [
      'fs.unlinkSync("x")',
      'fs.rmSync("x")',
      'fs.rmdirSync("x")',
      'fs.truncateSync("x",0)',
      'await fs.promises.unlink("x")',
      'fs.promises.rm("x")',
    ]) {
      it(`blocks: ${snippet}`, () => {
        const r = inspectJavascriptSafety(snippet, { projectPath: PROJECT });
        assert.equal(r.ok, false);
        assert.match(r.violations.join(';'), /delete\/truncate/i);
      });
    }
  });

  describe('write stream blocked', () => {
    for (const snippet of ['fs.createWriteStream("x")', 'fs.openSync("x","w")']) {
      it(`blocks: ${snippet}`, () => {
        const r = inspectJavascriptSafety(snippet, { projectPath: PROJECT });
        assert.equal(r.ok, false);
        assert.match(r.violations.join(';'), /writable file streams/i);
      });
    }
  });

  describe('child_process blocked', () => {
    for (const snippet of [
      'require("child_process")',
      "require('child_process')",
      'child_process.exec("ls")',
      'spawn("ls")',
      'execSync("ls")',
    ]) {
      it(`blocks: ${snippet}`, () => {
        const r = inspectJavascriptSafety(snippet, { projectPath: PROJECT });
        assert.equal(r.ok, false);
        assert.match(r.violations.join(';'), /child_process/i);
      });
    }
  });

  describe('string literal — traversal / home / absolute outside project', () => {
    it('blocks traversal ../', () => {
      const r = inspectJavascriptSafety('fs.readFileSync("../x","utf8")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.match(r.violations.join(';'), /traversal/i);
    });

    it('blocks home ~/', () => {
      const r = inspectJavascriptSafety('fs.readFileSync("~/secret","utf8")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.match(r.violations.join(';'), /home/i);
    });

    it('blocks absolute outside project', () => {
      const r = inspectJavascriptSafety('fs.readFileSync("C:/Windows/system32/drivers/etc/hosts","utf8")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.match(r.violations.join(';'), /outside.*project/i);
    });

    it('allows absolute inside project', () => {
      const proj = process.platform === 'win32' ? 'C:/proj' : '/tmp/proj';
      const inside = process.platform === 'win32' ? 'C:/proj/assets/a.json' : '/tmp/proj/assets/a.json';
      const r = inspectJavascriptSafety(`fs.readFileSync("${inside}","utf8")`, { projectPath: proj });
      assert.equal(r.ok, true, r.violations.join(';'));
    });

    it('allows relative inside-project path', () => {
      const r = inspectJavascriptSafety('fs.readFileSync(path.join(Editor.Project.path, "package.json"),"utf8")', { projectPath: PROJECT });
      assert.equal(r.ok, true, r.violations.join(';'));
    });

    it('deduplicates violations', () => {
      const r = inspectJavascriptSafety('fs.unlinkSync("a"); fs.unlinkSync("b")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.equal(r.violations.length, 1);
    });
  });

  describe('os.homedir / process.env + mutation blocked', () => {
    it('blocks fs.rmSync(os.homedir())', () => {
      const r = inspectJavascriptSafety('fs.rmSync(os.homedir()+"/x")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.match(r.violations.join(';'), /homedir/i);
    });

    it('blocks fs.unlinkSync(process.env.HOME)', () => {
      const r = inspectJavascriptSafety('fs.unlinkSync(process.env.HOME + "/x")', { projectPath: PROJECT });
      assert.equal(r.ok, false);
      assert.match(r.violations.join(';'), /environment paths/i);
    });
  });

  describe('assertJavascriptSafety throws on violation', () => {
    it('throws with blocked message', () => {
      assert.throws(() => assertJavascriptSafety('fs.unlinkSync("x")', { projectPath: PROJECT }), /safety checks blocked/i);
    });

    it('returns ok result when clean', () => {
      const r = assertJavascriptSafety('return 1+1', { projectPath: PROJECT });
      assert.equal(r.ok, true);
    });
  });
});
