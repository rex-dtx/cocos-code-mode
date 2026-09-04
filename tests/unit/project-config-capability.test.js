'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireDist } = require('../helpers/require-dist');

const { ToolError, toToolErrorResponse } = requireDist('utcp/tool-error.js');
const { isMessageNotExposed } = requireDist('utcp/utils/editor-message-error.js');
const { PROJECT_SET_CONFIG_SIGNATURE, probeProjectSetConfigCapability } = requireDist('utcp/tools/project-tools.js');
const { ProjectTools } = requireDist('utcp/tools/project-tools.js');

function installEditor(handler) {
  const previous = global.Editor;
  global.Editor = { Message: { request: handler } };
  return () => {
    if (previous === undefined) delete global.Editor;
    else global.Editor = previous;
  };
}

describe('projectManage gated 3.8 support (plan 2-todo-260831)', () => {
  // ── Shape / contract ──────────────────────────────────────────
  it('exposes the canonical 3.8 IPC signature constant', () => {
    assert.equal(
      PROJECT_SET_CONFIG_SIGNATURE,
      "Editor.Message.request('project','set-config','project', dotPath, value)"
    );
  });

  it('probe returns supported=false only on the registry verbatim "Message does not exist: project - set-config"', async () => {
    const restore = installEditor(async () => {
      throw new Error('Message does not exist: project - set-config');
    });
    try {
      const res = await probeProjectSetConfigCapability();
      assert.equal(res.supported, false);
      assert.equal(res.signature, PROJECT_SET_CONFIG_SIGNATURE);
      assert.match(res.error || '', /Message does not exist/i);
    } finally { restore(); }
  });

  it('probe returns supported=true when set-config throws a domain error (message IS exposed)', async () => {
    const restore = installEditor(async () => {
      throw new Error('Config path "__probe__.capability" does not exist');
    });
    try {
      const res = await probeProjectSetConfigCapability();
      assert.equal(res.supported, true);
      assert.equal(res.signature, PROJECT_SET_CONFIG_SIGNATURE);
      assert.equal(res.error, undefined);
    } finally { restore(); }
  });

  it('probe returns supported=true on success', async () => {
    const restore = installEditor(async () => true);
    try {
      const res = await probeProjectSetConfigCapability();
      assert.equal(res.supported, true);
      assert.equal(res.signature, PROJECT_SET_CONFIG_SIGNATURE);
    } finally { restore(); }
  });

  it('probe does not mistake other-module not-exposed for project/set-config', async () => {
    const restore = installEditor(async () => {
      throw new Error('Message does not exist: scene - new-scene');
    });
    try {
      const res = await probeProjectSetConfigCapability();
      // Must be true: the project message exists; the failure is for scene, not project/set-config.
      assert.equal(res.supported, true);
    } finally { restore(); }
  });

  it('probe uses isMessageNotExposed anchored predicate (no loose /does not exist/ branch)', () => {
    // Domain "does not exist" must NOT count as unsupported.
    assert.equal(isMessageNotExposed(new Error('Config path "x" does not exist'), 'project', 'set-config'), false);
    assert.equal(isMessageNotExposed(new Error('Message does not exist: project - set-config'), 'project', 'set-config'), true);
  });

  // ── 3.7 fallback (no IPC) ─────────────────────────────────────
  it('projectSetConfig on 3.7 throws ToolError 422 UNSUPPORTED_EDITOR_API with recovery', async () => {
    const restore = installEditor(async (module_, message) => {
      assert.equal(module_, 'project');
      assert.equal(message, 'set-config');
      throw new Error('Message does not exist: project - set-config');
    });
    try {
      const tools = new ProjectTools();
      await assert.rejects(
        () => tools.projectSetConfig({ path: 'general.designResolution', value: { width: 1280 } }),
        (err) => {
          assert.ok(err instanceof ToolError, 'must be ToolError');
          assert.equal(err.code, 'UNSUPPORTED_EDITOR_API');
          assert.equal(err.status, 422);
          assert.match(err.message, /3\.7 does not expose/);
          assert.equal(err.details && err.details.api, 'project/set-config');
          assert.equal(err.details && err.details.requiredEditorVersion, '3.8.x');
          assert.equal(err.details && err.details.requestedPath, 'general.designResolution');
          assert.match(err.recovery || '', /settings\/v2\/packages\/\*\.json/);
          const http = toToolErrorResponse(err);
          assert.equal(http.status, 422);
          assert.equal(http.body.code, 'UNSUPPORTED_EDITOR_API');
          assert.ok(http.body.recovery);
          return true;
        }
      );
    } finally { restore(); }
  });

  // ── 3.8 success path (mocked IPC) ─────────────────────────────
  it('projectSetConfig on 3.8 succeeds via IPC with (project, dotPath, value) shape', async () => {
    const calls = [];
    const restore = installEditor(async (module_, message, scope, dotPath, value) => {
      calls.push({ module_, message, scope, dotPath, value });
      assert.equal(module_, 'project');
      assert.equal(message, 'set-config');
      assert.equal(scope, 'project');
      assert.equal(dotPath, 'physics.gravity');
      assert.deepEqual(value, { x: 0, y: -9.8, z: 0 });
      return true;
    });
    try {
      const tools = new ProjectTools();
      const res = await tools.projectSetConfig({ path: 'physics.gravity', value: { x: 0, y: -9.8, z: 0 } });
      assert.deepEqual(res, { success: true });
      assert.equal(calls.length, 1);
    } finally { restore(); }
  });

  it('projectSetConfig treats false return as failure (no silent success)', async () => {
    const restore = installEditor(async () => false);
    try {
      const tools = new ProjectTools();
      await assert.rejects(
        () => tools.projectSetConfig({ path: 'general.designResolution', value: null }),
        (err) => {
          assert.ok(!(err instanceof ToolError) || err.code !== 'UNSUPPORTED_EDITOR_API');
          assert.match(String(err && err.message || err), /Failed to set project config/);
          return true;
        }
      );
    } finally { restore(); }
  });

  // ── No filesystem fallback ───────────────────────────────────
  it('project-tools has no filesystem fallback in the set path', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../source/utcp/tools/project-tools.ts'), 'utf8');
    // Must not import or call fs/path for writes.
    assert.doesNotMatch(src, /from ['"]fs['"]|from ['"]fs-extra['"]|require\(['"]fs/);
    assert.doesNotMatch(src, /writeFile|writeFileSync|outputFile|ensureFile/);
    // The recovery string legitimately mentions settings/v2/packages — but only
    // as text inside the ToolError recovery field, never as a write target.
    // So check the code never does a filesystem write; a bare substring check
    // would false-positive on the recovery message.
    assert.doesNotMatch(src, /writeFile|outputFile|createWriteStream|fs\./);
    const writeOccurrences = (src.match(/writeFile/g) || []).length;
    assert.equal(writeOccurrences, 0);
    // Must still route unsupported via the anchored predicate, not a loose /does not exist/ check.
    assert.match(src, /isMessageNotExposed\(/);
    assert.doesNotMatch(src, /\/does not exist\/i/);
  });
});
