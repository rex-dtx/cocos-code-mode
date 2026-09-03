// Offline parser for Cocos 3.x `.scene` / `.prefab` files.
//
// On-disk format (verified against `@cocos/creator-types` + a real g9664L.scene):
// a flat JSON array; entries carry `__type__`; intra-file links are `{ __id__: N }`
// positional indices; cross-file links are `{ __uuid__: ..., __expectedType__: ... }`.
// `__id__` is NEVER used as a persisted key (it breaks on every editor re-save);
// node `_id` is the stable handle and is what the editor reports as `reference.id`.
//
// Scope: T0 identity + T1 structure only. No position / property values (T2) — those
// must always be read live. See plan §Cacheability model + D6.

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Array(123).fill(64);
for (let i = 0; i < 64; i++) BASE64_VALUES[BASE64_KEYS.charCodeAt(i)] = i;
const HexChars = '0123456789abcdef'.split('');
const _t = ['', '', '', ''];
// 8 - 4 - 4 - 4 - 12 layout, 4 dashes, 32 hex slots.
const UuidTemplate = _t.concat(_t, '-', _t, '-', _t, '-', _t, '-', _t, _t, _t);
const HexIndices = UuidTemplate.map((x, i) => (x === '-' ? NaN : i)).filter(Number.isFinite);

/**
 * Port of `cocos/core/utils/decode-uuid.ts` (Creator 3.7.3 engine source).
 * Kept pure (copies the template) — the engine mutates its module-level array.
 * Golden vector from the engine docstring: 'fcmR3XADNLgJ1ByKhqcC5Z'
 *   -> 'fc991dd7-0033-4b80-9d41-c8a86a702e59'.
 */
export function decodeUuid(base64) {
  if (typeof base64 !== 'string') return base64;
  const strs = base64.split('@');
  const head = strs[0];
  if (head.length !== 22) return base64;
  const tpl = UuidTemplate.slice();
  tpl[0] = base64[0];
  tpl[1] = base64[1];
  for (let i = 2, j = 2; i < 22; i += 2) {
    const lhs = BASE64_VALUES[base64.charCodeAt(i)];
    const rhs = BASE64_VALUES[base64.charCodeAt(i + 1)];
    tpl[HexIndices[j++]] = HexChars[lhs >> 2];
    tpl[HexIndices[j++]] = HexChars[((lhs & 3) << 2) | (rhs >> 4)];
    tpl[HexIndices[j++]] = HexChars[rhs & 0xf];
  }
  return base64.replace(head, tpl.join(''));
}

// Bookkeeping entries that are not real components.
const SKIP_TYPES = new Set([
  'cc.SceneAsset', 'cc.Node', 'cc.Scene', 'cc.Prefab',
  'cc.PrefabInfo', 'cc.CompPrefabInfo', 'cc.TargetInfo',
  'CCPropertyOverrideInfo', 'cc.MountedChildrenInfo', 'cc.MountedComponentsInfo',
]);

function idOf(arr, ref) {
  if (!ref || typeof ref.__id__ !== 'number') return null;
  const entry = arr[ref.__id__];
  return entry && typeof entry._id === 'string' ? entry._id : null;
}

/** Collect every `{ __uuid__ }` occurrence under a value, with its property path. */
function collectUuidRefs(value, prop, out, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectUuidRefs(item, prop, out, depth + 1);
    return;
  }
  if (typeof value.__uuid__ === 'string') {
    out.push({ uuid: decodeUuid(value.__uuid__), prop });
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === '__type__' || k === '__id__') continue;
    collectUuidRefs(v, prop ? `${prop}.${k}` : k, out, depth + 1);
  }
}

/**
 * Parse a deserialized `.scene` / `.prefab` array into T0+T1 structure.
 * Returns { nodes, comps, refs, prefabOpaque }.
 */
export function parseEntries(arr) {
  if (!Array.isArray(arr)) throw new Error('parseEntries: expected the flat serialized array');

  const nodes = [];
  const byIndex = new Map();          // array index -> node record
  const nameByIndex = new Map();
  const parentByIndex = new Map();
  let prefabOpaque = false;

  for (let idx = 0; idx < arr.length; idx++) {
    const e = arr[idx];
    if (!e || (e.__type__ !== 'cc.Node' && e.__type__ !== 'cc.Scene')) continue;
    if (typeof e._id !== 'string' || !e._id) {
      // A node without `_id` has no stable handle — the editor cannot address it
      // across re-saves, so indexing it would fabricate identity. Fail loud instead.
      throw new Error(`parseEntries: cc.Node at index ${idx} (${e._name ?? '?'}) has no _id`);
    }
    byIndex.set(idx, e);
    nameByIndex.set(idx, e._name ?? (e.__type__ === 'cc.Scene' ? 'Scene' : ''));
    const parentIdx = e._parent && typeof e._parent.__id__ === 'number' ? e._parent.__id__ : null;
    parentByIndex.set(idx, parentIdx);
    if (e._prefab && typeof e._prefab.__id__ === 'number') prefabOpaque = true;
  }

  function pathOf(idx) {
    const parts = [];
    let cur = parentByIndex.get(idx);
    let guard = 0;
    while (cur != null && byIndex.has(cur) && guard++ < 200) {
      const entry = byIndex.get(cur);
      const n = nameByIndex.get(cur);
      const isScene = entry && entry.__type__ === 'cc.Scene';
      if (n && !isScene) parts.unshift(n);
      cur = parentByIndex.get(cur);
    }
    return '/' + parts.join('/');
  }

  const comps = [];
  const refs = [];
  for (const [idx, e] of byIndex) {
    const uuid = e._id;
    nodes.push({
      uuid,
      name: nameByIndex.get(idx),
      path: pathOf(idx),
      parent: idOf(arr, e._parent),
    });
    if (!Array.isArray(e._components)) continue;
    for (const cref of e._components) {
      if (!cref || typeof cref.__id__ !== 'number') continue;
      const comp = arr[cref.__id__];
      if (!comp || !comp.__type__ || SKIP_TYPES.has(comp.__type__)) continue;
      const type = comp.__type__;
      // Custom script components serialize `__type__` as a 22-char compressed uuid.
      const script = type.length === 22 ? decodeUuid(type) : null;
      comps.push({ node: uuid, type, script });
      const found = [];
      for (const [k, v] of Object.entries(comp)) {
        if (k === '__type__' || k === '_id' || k === 'node') continue;
        collectUuidRefs(v, k, found);
      }
      for (const r of found) refs.push({ node: uuid, uuid: r.uuid, prop: `${type}.${r.prop}` });
    }
  }

  return { nodes, comps, refs, prefabOpaque };
}

/** Parse one file's raw text. Throws on non-array / invalid JSON. */
export function parseSceneText(text) {
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (err) {
    throw new Error(`parseSceneText: invalid JSON (${err.message})`);
  }
  return parseEntries(arr);
}
