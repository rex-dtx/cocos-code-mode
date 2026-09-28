'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { classifyNativeWindows } = requireDist('utcp/windows-popup-observer.js');

it('normalizes bounded native dialog content and preserves truncation state', () => {
  const rows = [{
    hwnd: '0x100', pid: 123, visible: true, title: 'Creator', className: 'Chrome_WidgetWin_1', ownerHwnd: null, rootOwnerHwnd: '0x100',
    bounds: { x: 0, y: 0, width: 100, height: 100 }, actions: [], content: { text: null, source: null, truncated: false }, foreground: false, zOrderRank: null, lastActivePopup: false, enabledPopup: false,
  }, {
    hwnd: '0x200', pid: 123, visible: true, title: 'Warning', className: '#32770', ownerHwnd: '0x100', rootOwnerHwnd: '0x100',
    bounds: { x: 1, y: 1, width: 100, height: 50 }, actions: [], content: { text: 'Warning', source: 'native-control', truncated: false }, foreground: false, zOrderRank: null, lastActivePopup: false, enabledPopup: false,
  }];
  const records = classifyNativeWindows(rows, { processId: 123, creatorMainBounds: rows[0].bounds, creatorMainTitle: 'Creator', includeHidden: false, maxItems: 16 });
  const dialog = records.find(record => record.title === 'Warning');
  assert.ok(dialog);
  assert.deepEqual(dialog.content, rows[1].content);
});

it('keeps z-order unknown when native ordering evidence is absent', () => {
  const rows = [{
    hwnd: '0x100', pid: 123, visible: true, title: 'Creator', className: 'Chrome_WidgetWin_1', ownerHwnd: null, rootOwnerHwnd: '0x100',
    bounds: { x: 0, y: 0, width: 100, height: 100 }, actions: [], content: { text: null, source: null, truncated: false }, foreground: false, zOrderRank: null, lastActivePopup: false, enabledPopup: false,
  }, {
    hwnd: '0x200', pid: 123, visible: true, title: 'Warn', className: '#32770', ownerHwnd: '0x100', rootOwnerHwnd: '0x100',
    bounds: { x: 1, y: 1, width: 100, height: 50 }, actions: [], content: { text: 'Warning', source: 'native-control', truncated: false }, foreground: false, zOrderRank: null, lastActivePopup: false, enabledPopup: false,
  }];
  const dialog = classifyNativeWindows(rows, { processId: 123, creatorMainBounds: rows[0].bounds, creatorMainTitle: 'Creator', includeHidden: false, maxItems: 16 }).find(record => record.title === 'Warn');
  assert.deepEqual(dialog.zOrder, { foreground: false, rank: null, activePopup: false, confidence: 'unknown', source: null });
});

it('marks only the top verified Creator dialog as actionable from owner-group rank', () => {
  const base = { pid: 123, visible: true, foreground: false, bounds: { x: 0, y: 0, width: 100, height: 100 }, actions: [], content: { text: null, source: null, truncated: false }, lastActivePopup: false, enabledPopup: false };
  const rows = [
    { ...base, hwnd: '0x100', title: 'Creator', className: 'Chrome_WidgetWin_1', ownerHwnd: null, rootOwnerHwnd: '0x100', zOrderRank: 20, ownerGroupRank: null, topCandidate: false },
    { ...base, hwnd: '0x200', title: 'Warning', className: '#32770', ownerHwnd: '0x100', rootOwnerHwnd: '0x100', zOrderRank: 19, ownerGroupRank: 1, topCandidate: false },
    { ...base, hwnd: '0x300', title: 'Warn', className: '#32770', ownerHwnd: '0x100', rootOwnerHwnd: '0x100', zOrderRank: 18, ownerGroupRank: 0, topCandidate: true },
  ];
  const records = classifyNativeWindows(rows, { processId: 123, creatorMainBounds: base.bounds, creatorMainTitle: 'Creator', includeHidden: false, maxItems: 16 });
  assert.deepEqual(records.find(row => row.title === 'Warn').zOrder, { foreground: false, rank: 0, activePopup: true, confidence: 'medium', source: 'owner-group-order' });
  assert.deepEqual(records.find(row => row.title === 'Warning').zOrder, { foreground: false, rank: 1, activePopup: false, confidence: 'medium', source: 'owner-group-order' });
});
