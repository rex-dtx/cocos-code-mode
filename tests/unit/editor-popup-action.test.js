'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { requireDist } = require('../helpers/require-dist');

const { actOnEditorPopup } = requireDist('utcp/editor-popup-action.js');
const { resetEditorMessageProbes } = requireDist('utcp/editor-state.js');
const { getEditorControl } = requireDist('utcp/editor-control-plane.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
requireDist('utcp/tools/editor-tools.js');

const originalLoad = Module._load;
const previousEditor = global.Editor;
const popupId = 'native:1234:0XABC';

afterEach(() => {
  Module._load = originalLoad;
  resetEditorMessageProbes();
  if (previousEditor === undefined) delete global.Editor;
  else global.Editor = previousEditor;
});

function mockCreator() {
  global.Editor = { Message: { request: async () => false, broadcast() {} } };
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') return { BrowserWindow: { getAllWindows: () => [] }, desktopCapturer: { getSources: async () => [] } };
    return originalLoad.call(this, name, parent, isMain);
  };
}

function actionFixture() {
  const owner = { id: 'native:1234:0X100', title: 'Creator', visible: true, ownerVerified: true, classification: 'creator-main', signals: ['native-class:Chrome_WidgetWin_1'], content: { text: null, source: null, truncated: false }, actions: [] };
  const popup = { id: popupId, title: 'Warn', visible: true, ownerVerified: true, classification: 'dialog', parentId: owner.id, signals: ['native-dialog-class', 'native-owner'], content: { text: null, source: null, truncated: false }, actions: [{ id: 'native:1234:0XDEF', label: 'Confirm', enabled: true }] };
  const snapshot = { complete: true, windows: [owner, popup] };
  return { snapshot, popup };
}

describe('editorPopupAction', () => {
  it('rejects stale popup identities and does not post a misleading reminder', async () => {
    mockCreator();
    await assert.rejects(() => actOnEditorPopup({ operation: 'remind', popupId, popupTitle: 'Warn' }),
      error => error.code === 'POPUP_ACTION_STALE' && error.status === 409);
  });

  it('rejects a stale native popup before activation', async () => {
    mockCreator();
    await assert.rejects(() => actOnEditorPopup({ operation: 'activate', popupId, popupTitle: 'Warn', actionId: 'native:1234:0XDEF', actionLabel: 'Confirm', confirm: true, authorization: 'user-explicit' }),
      error => error.code === 'POPUP_ACTION_STALE' && error.status === 409);
  });

  it('requires an explicit exact-action authorization without dispatch', async () => {
    const { snapshot } = actionFixture();
    let dispatched = 0;
    const dependencies = { inspect: async () => snapshot, activate: async () => { dispatched++; return { activated: true, closed: true }; }, notify: () => ({ id: 'notice' }) };
    for (const args of [
      { confirm: false, authorization: 'user-explicit' },
      { confirm: true },
    ]) {
      await assert.rejects(() => actOnEditorPopup({ operation: 'activate', popupId, popupTitle: 'Warn', actionId: 'native:1234:0XDEF', actionLabel: 'Confirm', ...args }, dependencies), error => error.code === 'POPUP_ACTION_UNAUTHORIZED');
    }
    assert.equal(dispatched, 0);
  });

  it('activates an explicitly authorized exact action and proves the original popup closed', async () => {
    const { snapshot, popup } = actionFixture();
    let reads = 0;
    let dispatched = 0;
    const dependencies = { inspect: async () => ++reads === 1 ? snapshot : { complete: true, windows: snapshot.windows.filter(window => window.id !== popup.id) }, activate: async (...identity) => { dispatched++; assert.deepEqual(identity, [popup.id, popup.actions[0].id, popup.title, popup.actions[0].label, popup.parentId, 'Creator', 'Chrome_WidgetWin_1', popup.content]); return { activated: true, closed: true }; }, notify: () => ({ id: 'notice' }) };
    const result = await actOnEditorPopup({ operation: 'activate', popupId, popupTitle: 'Warn', actionId: 'native:1234:0XDEF', actionLabel: 'Confirm', confirm: true, authorization: 'user-explicit' }, dependencies);
    assert.equal(result.activated, true);
    assert.equal(result.closed, true);
    assert.equal(dispatched, 1);
  });

  it('registers a direct exact-action POST with strict inputs and bounded outputs', () => {
    const route = ToolRegistry.getTools().find(entry => entry.tool.name === 'editorPopupAction');
    assert.ok(route);
    assert.equal(route.tool.tool_call_template.http_method, 'POST');
    assert.equal(route.tool.inputs.additionalProperties, false);
    assert.equal(route.tool.outputs.properties.activated.type, 'boolean');
    const inspect = ToolRegistry.getTools().find(entry => entry.tool.name === 'editorPopupInspect');
    assert.equal(inspect.tool.outputs.properties.windows.items.properties.actions.maxItems, 16);
  });
});
