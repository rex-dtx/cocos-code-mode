'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { pickEditorWindow } = requireDist('utcp/tools-2x/screenshot-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');

function fakeWin(id, title, focused) {
  return { id, getTitle: () => title, focused };
}

describe('screenshot-tools — pickEditorWindow', () => {
  it('matches windowTitle substring', () => {
    const a = fakeWin(1, 'Cocos Creator — hello', false);
    const b = fakeWin(2, 'Console', true);
    const BrowserWindow = {
      getAllWindows: () => [a, b],
      getFocusedWindow: () => b,
    };
    assert.equal(pickEditorWindow(BrowserWindow, 'Cocos'), a);
  });

  it('falls back to focused window when title misses', () => {
    const a = fakeWin(1, 'A', false);
    const b = fakeWin(2, 'B', true);
    const BrowserWindow = {
      getAllWindows: () => [a, b],
      getFocusedWindow: () => b,
    };
    assert.equal(pickEditorWindow(BrowserWindow, 'Nope'), b);
  });

  it('throws NO_EDITOR_WINDOW when none exist', () => {
    const BrowserWindow = {
      getAllWindows: () => [],
      getFocusedWindow: () => null,
    };
    assert.throws(
      () => pickEditorWindow(BrowserWindow),
      (err) => err instanceof ToolError && err.code === 'NO_EDITOR_WINDOW' && err.status === 422
    );
  });
});
