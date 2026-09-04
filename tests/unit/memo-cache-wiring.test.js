'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist, readSource } = require('../helpers/require-dist');

describe('P0 memo wiring — invalidateAfterWrite', () => {
  it('definition cache is keyed by class, not by instance id', () => {
    const src = readSource('utcp/tools/typescript-defenition.ts');
    assert.doesNotMatch(src, /`inst:\$\{params\.reference\.id\}/);
    assert.match(src, /\$\{className\}:\$\{sectionSuffix\}/);
    assert.match(src, /fastType/);
  });

  it('asset write paths evict both caches via invalidateAfterWrite', () => {
    for (const rel of [
      'utcp/tools/asset-tools.ts',
      'utcp/tools/prefab-json-tools.ts',
      'utcp/tools/file-tools.ts',
      'utcp/tools/batch-tools.ts',
    ]) {
      assert.match(readSource(rel), /invalidateAfterWrite\(/);
    }
    // The old L2-only call should be gone at write sites (kept only for query cache read wiring).
    const assetSrc = readSource('utcp/tools/asset-tools.ts');
    assert.doesNotMatch(assetSrc, /assetQueryMemo\.invalidate\(\)/);
  });

  it('invalidateAfterWrite clears L1 and targeted L2, leaving unrelated queries', () => {
    const mod = requireDist('utcp/utils/memo-cache.js');
    const { definitionMemo, assetQueryMemo, invalidateAfterWrite, assetQueryKey } = mod;
    definitionMemo.invalidate(); assetQueryMemo.invalidate();
    const k1 = assetQueryKey({ pattern: 'db://assets/a/**' });
    const k2 = assetQueryKey({ pattern: 'db://assets/b/**' });
    assetQueryMemo.set(k1, [{ uuid: 'a' }]);
    assetQueryMemo.set(k2, [{ uuid: 'b' }]);
    definitionMemo.set('cc.Sprite:', { definition: 'x', sections: ['x'], totalSections: 1 });
    invalidateAfterWrite(k1);
    assert.equal(assetQueryMemo.get(k1), undefined);
    assert.ok(assetQueryMemo.get(k2), 'unrelated query must survive targeted invalidation');
    assert.equal(definitionMemo.size, 0, 'L1 always clears even on targeted L2 eviction');
    assetQueryMemo.invalidate();
  });

  it('invalidateAfterWrite() without args clears both caches', () => {
    const mod = requireDist('utcp/utils/memo-cache.js');
    const { definitionMemo, assetQueryMemo, invalidateAfterWrite } = mod;
    definitionMemo.set('cc.Label:', { definition: 'y', sections: ['y'], totalSections: 1 });
    assetQueryMemo.set('k', 'v');
    invalidateAfterWrite();
    assert.equal(definitionMemo.size, 0);
    assert.equal(assetQueryMemo.size, 0);
  });
});
