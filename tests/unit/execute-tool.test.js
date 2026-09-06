'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { ExecuteTools } = requireDist('utcp/execute/execute-tool.js');

describe('executeJavascript — editor context', () => {
  const tools = new ExecuteTools();

  it('evaluates synchronous expressions', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'return 1 + 2;',
    });
    assert.deepEqual(res, { result: 3 });
  });

  it('evaluates asynchronous expressions with await', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'const val = await Promise.resolve(42); return val * 2;',
    });
    assert.deepEqual(res, { result: 84 });
  });

  it('passes args object to the evaluated script', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'return args.a + args.b;',
      args: { a: 10, b: 25 },
    });
    assert.deepEqual(res, { result: 35 });
  });

  it('coerces undefined to null', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'const x = 5;',
    });
    assert.deepEqual(res, { result: null });
  });

  it('blocks unsafe code when safety_checks is default/true', async () => {
    await assert.rejects(
      () => tools.executeJavascript({
        context: 'editor',
        code: 'fs.unlinkSync("test.txt");',
      }),
      /safety checks blocked/i
    );
  });

  it('allows code when safety_checks is false', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'return typeof fs.unlinkSync === "function";',
      safety_checks: false,
    });
    assert.deepEqual(res, { result: true });
  });

  it('guards async hangs with timeout_ms', async () => {
    await assert.rejects(
      () => tools.executeJavascript({
        context: 'editor',
        code: 'await new Promise(() => {});',
        timeout_ms: 100,
      }),
      /timed out after 100ms/i
    );
  });

  it('coerces circular structures to JSON-safe null or filtered', async () => {
    const res = await tools.executeJavascript({
      context: 'editor',
      code: 'const obj = { name: "test" }; obj.self = obj; return obj;',
    });
    assert.equal(res.result.name, 'test');
    assert.equal(res.result.self, undefined);
  });
});
