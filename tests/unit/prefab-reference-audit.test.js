'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { requireDist } = require('../helpers/require-dist');

const { PrefabJsonTools } = requireDist('utcp/tools-2x/prefab-json-tools.js');
const { ToolError } = requireDist('utcp/tool-error.js');
const SOURCE_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NESTED_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MISSING_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SPRITE_UUID = 'fc991dd7-0033-4b80-9d41-c8a86a702e59';
const SOURCE_URL = 'db://assets/Root.prefab';

async function withPrefab(value, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefab-audit-'));
  const file = path.join(dir, 'Root.prefab');
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  fs.writeFileSync(file, content);
  const prior = global.Editor;
  global.Editor = {
    assetdb: {
      uuidToUrl(id) {
        return ({ [SOURCE_UUID]: SOURCE_URL, [NESTED_UUID]: 'db://assets/Nested.prefab', [SPRITE_UUID]: 'db://assets/Icon.png' })[id] || null;
      },
      uuidToFspath(id) { return id === SOURCE_UUID ? file : null; },
      urlToFspath() { return null; },
      assetInfoByUuid(id) { return id === SOURCE_UUID ? { url: SOURCE_URL, type: 'cc.Prefab' } : null; },
    },
  };
  try { await fn(new PrefabJsonTools(), content); }
  finally { global.Editor = prior; fs.rmSync(dir, { recursive: true, force: true }); }
}

const base = () => [
  { __type__: 'cc.Prefab', data: { __id__: 1 } },
  { __type__: 'cc.Node', _id: MISSING_UUID, _prefab: { __id__: 2 }, _components: [{ __id__: 3 }] },
  { __type__: 'cc.PrefabInfo', asset: { __id__: 0 }, fileId: NESTED_UUID },
  { __type__: 'cc.Sprite', _spriteFrame: { __uuid__: SPRITE_UUID } },
];

describe('Creator 2.4 prefabReferenceAudit', () => {
  it('separates nested imports and missing dependencies from local ids and fileIds', async () => {
    const prefab = base();
    prefab.push({ __type__: 'cc.PrefabInfo', asset: { __uuid__: NESTED_UUID }, fileId: SPRITE_UUID });
    prefab.push({ __type__: 'cc.Sprite', image: { __uuid__: MISSING_UUID } });
    await withPrefab(prefab, async (tool, content) => {
      const result = await tool.prefabReferenceAudit({ uuid: SOURCE_UUID });
      assert.deepEqual(result.nestedPrefabs, [{ uuid: NESTED_UUID, url: 'db://assets/Nested.prefab' }]);
      assert.deepEqual(result.missingReferences, [{ id: MISSING_UUID }]);
      assert.equal(result.totalReferences, 3);
      assert.equal(result.valid, false);
      assert.equal(result.truncated, false);
      assert.deepEqual(result.source, { uuid: SOURCE_UUID, url: SOURCE_URL, sha256: createHash('sha256').update(content).digest('hex'), reloaded: false });
    });
  });

  it('bounds audited references while retaining the total and truncation state', async () => {
    const prefab = base();
    prefab.push({ __type__: 'cc.PrefabInfo', asset: { __uuid__: NESTED_UUID } });
    prefab.push({ __type__: 'cc.Sprite', image: { __uuid__: MISSING_UUID } });
    await withPrefab(prefab, async tool => {
      const result = await tool.prefabReferenceAudit({ uuid: SOURCE_UUID, maxReferences: 1 });
      assert.equal(result.totalReferences, 3);
      assert.equal(result.truncated, true);
      assert.deepEqual(result.missingReferences, []);
      assert.equal(result.valid, false);
      assert.equal(result.nestedPrefabs.length, 1);
    });
  });

  it('refuses malformed locators before asset lookup', async () => {
    await withPrefab(base(), async tool => {
      for (const args of [null, { uuid: 42 }, { assetPath: false }]) {
        await assert.rejects(tool.prefabReferenceAudit(args), err => err instanceof ToolError && err.code === 'INVALID_ARGUMENT');
      }
    });
  });
  it('rejects malformed and unknown serialization rather than claiming no missing dependencies', async () => {
    for (const invalid of [
      { invalid: true },
      [{ __type__: 'cc.Prefab', data: { __id__: 1 } }, { __type__: 'cc.Node', asset: { __uuid__: 'not-a-uuid' } }],
      [{ __type__: 'cc.Prefab', data: { __id__: 1 } }, { __type__: 'cc.Node', child: { __id__: 12 } }],
    ]) {
      await withPrefab(invalid, async tool => {
        await assert.rejects(tool.prefabReferenceAudit({ uuid: SOURCE_UUID }), err => err instanceof ToolError && err.code === 'UNSUPPORTED_PREFAB_SERIALIZATION');
      });
    }
  });
});
