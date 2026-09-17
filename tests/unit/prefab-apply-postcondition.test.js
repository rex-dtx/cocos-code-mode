'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');
const { methods } = requireDist('scene.js');

it('accepts native false only after linked prefab overrides are actually applied', async () => {
  const originalCce = global.cce;
  const originalFind = methods.findRuntimeNodeUuid;
  const node = { _prefab: { fileId: 'root', asset: { _uuid: 'prefab' }, instance: { propertyOverrides: [{ path: 'name', value: 'new' }], mountedChildren: [], mountedComponents: [], removedComponents: [] } } };
  methods.findRuntimeNodeUuid = async () => node;
  global.cce = { Prefab: { applyPrefab: async () => false } };
  try {
    assert.match(await methods.applyPrefabByNode('node'), /pending propertyOverrides/);
    global.cce.Prefab.applyPrefab = async () => { node._prefab.instance.propertyOverrides = []; return false; };
    assert.equal(await methods.applyPrefabByNode('node'), null);
    node._prefab.instance.propertyOverrides = [{ targetInfo: { localID: ['root'] }, propertyPath: ['_lpos'], value: 1 }];
    global.cce.Prefab.applyPrefab = async () => false;
    assert.equal(await methods.applyPrefabByNode('node'), null, 'Creator intentionally preserves root placement overrides');
    global.cce.Prefab.applyPrefab = async () => { node._prefab.asset._uuid = 'other'; return false; };
    assert.match(await methods.applyPrefabByNode('node'), /identity changed/);
  } finally {
    methods.findRuntimeNodeUuid = originalFind;
    if (originalCce === undefined) delete global.cce; else global.cce = originalCce;
  }
});
