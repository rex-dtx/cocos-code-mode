// Offline parser for Cocos Creator 2.4 `.fire` / `.prefab` files.
// Persists T0 identity + T1 structure only. Cocos IDs are file-local, so every
// record also carries a composite graph handle: <project-relative-file>#<engine-id>.

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = new Array(123).fill(64);
for (let i = 0; i < 64; i++) BASE64_VALUES[BASE64_KEYS.charCodeAt(i)] = i;
const HEX = '0123456789abcdef';

function decodeCompressedHead(head) {
  const prefixLength = head.length === 23 ? 5 : head.length === 22 ? 2 : 0;
  if (!prefixLength) return null;
  let hex = head.slice(0, prefixLength);
  for (let i = prefixLength; i < head.length; i += 2) {
    const lhs = BASE64_VALUES[head.charCodeAt(i)];
    const rhs = BASE64_VALUES[head.charCodeAt(i + 1)];
    if (lhs === 64 || rhs === 64) return null;
    hex += HEX[lhs >> 2];
    hex += HEX[((lhs & 3) << 2) | (rhs >> 4)];
    hex += HEX[rhs & 0xf];
  }
  if (hex.length !== 32) return null;
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function decodeUuid(base64) {
  if (typeof base64 !== 'string') return base64;
  const [head] = base64.split('@');
  const decoded = decodeCompressedHead(head);
  return decoded ? base64.replace(head, decoded) : base64;
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
  let serializedNodes = 0;
  let omittedNodes = 0;
  let serializedComponents = 0;
  let omittedComponents = 0;
  let prefabOpaque = false;

  for (let index = 0; index < arr.length; index++) {
    const entry = arr[index];
    if (!entry || (entry.__type__ !== 'cc.Node' && entry.__type__ !== 'cc.Scene')) continue;
    serializedNodes++;
    const uuid = stableId(arr, entry);
    if (!uuid) {
      omittedNodes++;
      prefabOpaque = true;
      continue;
    }
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
  for (let index = 0; index < arr.length; index++) {
    const entry = arr[index];
    if (!entry || (entry.__type__ !== 'cc.Node' && entry.__type__ !== 'cc.Scene')) continue;
    const record = byIndex.get(index);
    const components = (Array.isArray(entry._components) ? entry._components : [])
      .map((componentRef) => typeof componentRef?.__id__ === 'number' ? arr[componentRef.__id__] : null)
      .filter((component) => component?.__type__ && !SKIP_TYPES.has(component.__type__));
    serializedComponents += components.length;
    if (!record) {
      omittedComponents += components.length;
      continue;
    }

    const { uuid, handle } = record;
    const parentIndex = typeof entry._parent?.__id__ === 'number' ? entry._parent.__id__ : null;
    const parent = parentIndex != null ? byIndex.get(parentIndex)?.handle ?? null : null;
    nodes.push({ handle, uuid, file: normalizedFile, source, name: entry._name ?? (entry.__type__ === 'cc.Scene' ? 'Scene' : ''), path: pathOf(index), parent });

    for (const component of components) {
      const type = component.__type__;
      const componentUuid = stableId(arr, component);
      const componentHandle = componentUuid ? makeHandle(normalizedFile, `component:${componentUuid}`) : null;
      const script = type.length === 22 || type.length === 23 ? decodeUuid(type) : null;
      comps.push({ handle: componentHandle, uuid: componentUuid, node: handle, nodeUuid: uuid, file: normalizedFile, source, type, script });
      const found = [];
      for (const [key, value] of Object.entries(component)) {
        if (key === '__type__' || key === '_id' || key === 'node') continue;
        collectUuidRefs(value, key, found);
      }
      for (const ref of found) refs.push({ node: handle, nodeUuid: uuid, file: normalizedFile, source, uuid: ref.uuid, prop: `${type}.${ref.prop}` });
    }
  }
  return {
    nodes,
    comps,
    refs,
    prefabOpaque,
    serializedNodes,
    indexedNodes: nodes.length,
    omittedNodes,
    serializedComponents,
    indexedComponents: comps.length,
    omittedComponents,
  };
}

export function parseSceneText(text, options) {
  let entries;
  try { entries = JSON.parse(text); }
  catch (error) { throw new Error(`parseSceneText: invalid JSON (${error.message})`); }
  return parseEntries(entries, options);
}
