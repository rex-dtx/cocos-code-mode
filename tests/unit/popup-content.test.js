'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { classifyNativeWindows } = requireDist('utcp/windows-popup-observer.js');

it('normalizes bounded native dialog content and preserves truncation state', () => {
  const rows = [{
    hwnd: '0x100', pid: 123, visible: true, title: 'Creator', className: 'Chrome_WidgetWin_1',
    ownerHwnd: null, rootOwnerHwnd: '0x100', bounds: { x: 0, y: 0, width: 100, height: 100 },
    actions: [], content: { text: null, source: null, truncated: false },
  }, {
    hwnd: '0x200', pid: 123, visible: true, title: 'Warning', className: '#32770',
    ownerHwnd: '0x100', rootOwnerHwnd: '0x100', bounds: { x: 1, y: 1, width: 100, height: 50 },
    actions: [{ hwnd: '0x300', label: 'Cancel', enabled: true }],
    content: { text: 'Scene data has been modified.\nDo you want to save data to the file?', source: 'native-control', truncated: false },
  }];
  const records = classifyNativeWindows(rows, { processId: 123, creatorMainBounds: rows[0].bounds, creatorMainTitle: 'Creator', includeHidden: false, maxItems: 16 });
  const dialog = records.find(record => record.title === 'Warning');
  assert.ok(dialog);
  assert.deepEqual(dialog.content, rows[1].content);
});
