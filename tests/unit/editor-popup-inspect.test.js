'use strict';
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { requireDist } = require('../helpers/require-dist');

const { classifyPopupWindows } = requireDist('utcp/editor-popup-classifier.js');
const { inspectEditorPopups } = requireDist('utcp/editor-popup-observer.js');
const { resetEditorMessageProbes } = requireDist('utcp/editor-state.js');
const { ToolRegistry } = requireDist('utcp/decorators.js');
requireDist('utcp/tools/editor-tools.js');

const previousEditor = global.Editor;
const originalLoad = Module._load;

afterEach(() => {
  Module._load = originalLoad;
  resetEditorMessageProbes();
  if (previousEditor === undefined) delete global.Editor;
  else global.Editor = previousEditor;
});

function observation(overrides = {}) {
  return {
    source: 'electron',
    id: 'electron:1',
    title: 'Creator',
    visible: true,
    focused: false,
    modal: false,
    parentId: null,
    ownerVerified: false,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    signals: [],
    classificationEvidence: {},
    ...overrides,
  };
}

function electronWindow({ id, title, url, type = 'window', visible = true, modal = false, parent = null, focused = false }) {
  const window = {
    id,
    getTitle: () => title,
    isVisible: () => visible,
    isFocused: () => focused,
    isModal: () => modal,
    getParentWindow: () => parent,
    getBounds: () => ({ x: id * 10, y: id * 5, width: 800, height: 600 }),
    webContents: {
      isDestroyed: () => false,
      getURL: () => url,
      getType: () => type,
    },
  };
  return window;
}

function installEditorAndElectron({ dialog = false, windows = [], desktopSources = [] } = {}) {
  global.Editor = {
    Project: { path: 'C:/Creator/project' },
    Message: { request: async (channel, message) => {
      assert.equal(channel, 'information');
      assert.equal(message, 'has-dialog');
      return dialog;
    } },
  };
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') {
      return {
        BrowserWindow: {
          getAllWindows: () => windows,
          getFocusedWindow: () => windows.find(window => window.isFocused?.()) || null,
        },
        desktopCapturer: { getSources: async () => desktopSources },
      };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
}

describe('editor popup classifier', () => {
  it('classifies main, modal child, worker, devtools, panel, and unknown records without title matching', () => {
    const result = classifyPopupWindows(
      { available: true, open: false, source: 'information/has-dialog' },
      [
        observation({ id: 'electron:1', classificationEvidence: { creatorMain: true } }),
        observation({ id: 'electron:2', title: 'Localized warning', modal: true, parentId: 'electron:1', ownerVerified: true }),
        observation({ id: 'electron:3', title: 'Worker', visible: false, classificationEvidence: { worker: true } }),
        observation({ id: 'electron:4', title: 'Tools', classificationEvidence: { devtools: true } }),
        observation({ id: 'electron:5', title: 'Packages' }),
        observation({ source: 'native', id: 'native:99:7', title: 'Unknown', visible: false, modal: null }),
      ],
      { maxItems: 32, complete: true, unavailable: [] },
    );
    const byId = Object.fromEntries(result.windows.map(window => [window.id, window]));
    assert.equal(byId['electron:1'].classification, 'creator-main');
    assert.equal(byId['electron:2'].classification, 'dialog');
    assert.equal(byId['electron:3'].classification, 'worker');
    assert.equal(byId['electron:4'].classification, 'devtools');
    assert.equal(byId['electron:5'].classification, 'panel');
    assert.equal(byId['native:99:7'].classification, 'unknown');
    assert.equal(result.detected, true);
    assert.equal(result.blocking, true);
  });

  it('sorts and truncates deterministically while preserving total count', () => {
    const result = classifyPopupWindows(
      { available: true, open: false, source: 'information/has-dialog' },
      [observation({ id: 'electron:12' }), observation({ id: 'electron:2' }), observation({ id: 'electron:7' })],
      { maxItems: 2, complete: true, unavailable: [] },
    );
    assert.deepEqual(result.windows.map(window => window.id), ['electron:2', 'electron:7']);
    assert.equal(result.total, 3);
    assert.equal(result.truncated, true);
  });

  it('does not claim unblocked coverage when an adapter is unavailable', () => {
    const result = classifyPopupWindows(
      { available: false, open: null, source: null },
      [],
      { maxItems: 16, complete: false, unavailable: ['creator-dialog-ipc'] },
    );
    assert.equal(result.detected, false);
    assert.equal(result.blocking, null);
    assert.equal(result.complete, false);
  });
});

describe('editorPopupInspect', () => {
  it('returns a complete no-popup snapshot and excludes hidden worker windows by default', async () => {
    const main = electronWindow({ id: 1, title: 'Creator', url: 'file:///C:/Creator/@editor/creator/static/windows/main.html#project', focused: true });
    const worker = electronWindow({ id: 3, title: 'Worker - Assets', url: 'file:///C:/Creator/worker.html', visible: false, type: 'backgroundPage' });
    installEditorAndElectron({ windows: [main, worker] });
    const result = await inspectEditorPopups();
    assert.equal(result.detected, false);
    assert.equal(result.blocking, false);
    assert.equal(result.complete, true);
    assert.deepEqual(result.unavailable, []);
    assert.equal(result.windows.length, 1);
    assert.equal(result.windows[0].classification, 'creator-main');
  });

  it('detects an owned modal child without interacting with it', async () => {
    const main = electronWindow({ id: 1, title: 'Creator', url: 'file:///C:/Creator/@editor/creator/static/windows/main.html#project', focused: true });
    const dialog = electronWindow({ id: 2, title: 'Localized warning', url: 'file:///C:/Creator/dialog.html', modal: true, parent: main });
    installEditorAndElectron({ windows: [main, dialog] });
    let changed = false;
    const before = { title: dialog.getTitle(), visible: dialog.isVisible(), focused: dialog.isFocused() };
    const result = await inspectEditorPopups({ includeHidden: false, maxItems: 16 });
    changed = before.title !== dialog.getTitle() || before.visible !== dialog.isVisible() || before.focused !== dialog.isFocused();
    assert.equal(result.detected, true);
    assert.equal(result.blocking, true);
    assert.equal(result.complete, true);
    assert.equal(result.windows.find(window => window.id === 'electron:2').classification, 'dialog');
    assert.equal(changed, false);
  });

  it('reports typed incomplete coverage when native inspection is requested before its live gate', async () => {
    const main = electronWindow({ id: 1, title: 'Creator', url: 'file:///C:/Creator/@editor/creator/static/windows/main.html#project' });
    installEditorAndElectron({ windows: [main] });
    const result = await inspectEditorPopups({ includeNative: true });
    assert.equal(result.complete, false);
    assert.ok(result.unavailable.includes('windows-native'));
    assert.equal(result.detected, false);
    assert.equal(result.blocking, null);
  });

  it('rejects malformed bounded input before probing Creator', async () => {
    let calls = 0;
    global.Editor = { Message: { request: async () => { calls++; return false; } } };
    await assert.rejects(() => inspectEditorPopups({ maxItems: 33 }), error => error.code === 'INVALID_ARGUMENT' && error.status === 400);
    assert.equal(calls, 0);
  });

  it('registers a read-only GET route with strict schemas', () => {
    const metadata = ToolRegistry.getTools().find(({ tool }) => tool.name === 'editorPopupInspect');
    assert.ok(metadata);
    assert.equal(metadata.tool.tool_call_template.http_method, 'GET');
    assert.equal(metadata.tool.inputs.additionalProperties, false);
    assert.deepEqual(metadata.tool.inputs.required, []);
    assert.deepEqual(metadata.tool.outputs.required, ['capturedAt', 'detected', 'blocking', 'raceDetected', 'creatorDialog', 'windows', 'total', 'truncated', 'complete', 'unavailable']);
  });
});
