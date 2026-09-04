// Offline parser for Cocos 3.x `.scene` / `.prefab` files.
// Persists T0 identity + T1 structure only. Cocos IDs are file-local, so every
// record also carries a composite graph handle: <project-relative-file>#<engine-id>.

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Array(123).fill(64);
for (let i = 0; i < 64; i++) BASE64_VALUES[BASE64_KEYS.charCodeAt(i)] = i;
const HEX = '0123456789abcdef'.split('');
const T = ['', '', '', ''];
const UUID_TEMPLATE = T.concat(T, '-', T, '-', T, '-', T, '-', T, T, T);
const HEX_INDICES = UUID_TEMPLATE.map((x, i) => (x === '-' ? NaN : i)).filter(Number.isFinite);

export function decodeUuid(base64) {
  if (typeof base64 !== 'string') return base64;
  const [head] = base64.split('@');
  if (head.length !== 22) return base64;
  const tpl = UUID_TEMPLATE.slice();
  tpl[0] = head[0];
  tpl[1] = head[1];
  for (let i = 2, j = 2; i < 22; i += 2) {
    const lhs = BASE64_VALUES[head.charCodeAt(i)];
    const rhs = BASE64_VALUES[head.charCodeAt(i + 1)];
    tpl[HEX_INDICES[j++]] = HEX[lhs >> 2];
    tpl[HEX_INDICES[j++]] = HEX[((lhs & 3) << 2) | (rhs >> 4)];
    tpl[HEX_INDICES[j++]] = HEX[rhs & 0xf];
  }
  return base64.replace(head, tpl.join(''));
}

export function makeHandle(file, uuid) {
  if (!file || !uuid) throw new Error('makeHandle: file and uuid are required');
  return `${String(file).replace(/\\/g, '/')}#${uuid}`;
}

export function parseHandle(handle) {
  const split = String(handle ?? '').lastIndexOf('#');
  if (split <= 0 || split === String(handle).length - 1) return null;
  return { file: handle.slice(0, split), uuid: handle.slice(split + 1) };
}

const SKIP_TYPES = new Set([
  'cc.SceneAsset', 'cc.Node', 'cc.Scene', 'cc.Prefab',
  'cc.PrefabInfo', 'cc.CompPrefabInfo', 'cc.TargetInfo',
  'CCPropertyOverrideInfo', 'cc.MountedChildrenInfo', 'cc.MountedComponentsInfo',
]);

function prefabFileId(arr, entry) {
  if (!entry?._prefab || typeof entry._prefab.__id__ !== 'number') return null;
  const info = arr[entry._prefab.__id__];
  return typeof info?.fileId === 'string' && info.fileId ? info.fileId : null;
}

function stableId(arr, entry) {
  return typeof entry?._id === 'string' && entry._id ? entry._id : prefabFileId(arr, entry);
}

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
  for (const [key, child] of Object.entries(value)) {
    if (key === '__type__' || key === '__id__') continue;
    collectUuidRefs(child, prop ? `${prop}.${key}` : key, out, depth + 1);
  }
}

export function parseEntries(arr, { file = 'unknown', source = 'disk' } = {}) {
  if (!Array.isArray(arr)) throw new Error('parseEntries: expected the flat serialized array');
  const normalizedFile = String(file).replace(/\\/g, '/');
  const byIndex = new Map();
  let prefabOpaque = false;

  for (let index = 0; index < arr.length; index++) {
    const entry = arr[index];
    if (!entry || (entry.__type__ !== 'cc.Node' && entry.__type__ !== 'cc.Scene')) continue;
    const uuid = stableId(arr, entry);
    if (!uuid) continue; // unexpanded prefab instance: only the live editor can resolve it
    byIndex.set(index, { entry, uuid, handle: makeHandle(normalizedFile, uuid) });
    if (entry._prefab && typeof entry._prefab.__id__ === 'number') prefabOpaque = true;
  }

  const pathOf = (start) => {
    const parts = [];
    let index = start;
    const visited = new Set();
    while (index != null && byIndex.has(index) && !visited.has(index)) {
      visited.add(index);
      const { entry } = byIndex.get(index);
      if (entry.__type__ !== 'cc.Scene' && entry._name) parts.unshift(entry._name);
      index = typeof entry._parent?.__id__ === 'number' ? entry._parent.__id__ : null;
    }
    return '/' + parts.join('/');
  };

  const nodes = [];
  const comps = [];
  const refs = [];
  for (const [index, record] of byIndex) {
    const { entry, uuid, handle } = record;
    const parentIndex = typeof entry._parent?.__id__ === 'number' ? entry._parent.__id__ : null;
    const parent = parentIndex != null ? byIndex.get(parentIndex)?.handle ?? null : null;
    nodes.push({ handle, uuid, file: normalizedFile, source, name: entry._name ?? (entry.__type__ === 'cc.Scene' ? 'Scene' : ''), path: pathOf(index), parent });

    for (const componentRef of Array.isArray(entry._components) ? entry._components : []) {
      if (typeof componentRef?.__id__ !== 'number') continue;
      const component = arr[componentRef.__id__];
      if (!component?.__type__ || SKIP_TYPES.has(component.__type__)) continue;
      const type = component.__type__;
      const componentUuid = stableId(arr, component);
      const componentHandle = componentUuid ? makeHandle(normalizedFile, `component:${componentUuid}`) : null;
      const script = type.length === 22 ? decodeUuid(type) : null;
      comps.push({ handle: componentHandle, uuid: componentUuid, node: handle, nodeUuid: uuid, file: normalizedFile, source, type, script });
      const found = [];
      for (const [key, value] of Object.entries(component)) {
        if (key === '__type__' || key === '_id' || key === 'node') continue;
        collectUuidRefs(value, key, found);
      }
      for (const ref of found) refs.push({ node: handle, nodeUuid: uuid, file: normalizedFile, source, uuid: ref.uuid, prop: `${type}.${ref.prop}` });
    }
  }
  return { nodes, comps, refs, prefabOpaque };
}

export function parseSceneText(text, options) {
  let entries;
  try { entries = JSON.parse(text); }
  catch (error) { throw new Error(`parseSceneText: invalid JSON (${error.message})`); }
  return parseEntries(entries, options);
}
