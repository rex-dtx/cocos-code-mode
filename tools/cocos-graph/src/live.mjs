import { makeHandle } from './parser.mjs';

export function unwrapLiveSnapshot(payload) {
  const tree = payload?.tree ?? payload;
  const sourceFile = payload?.sourceFile ?? payload?.file ?? tree?.sourceFile ?? null;
  const dirty = typeof payload?.dirty === 'boolean' ? payload.dirty : 'unknown';
  if (!sourceFile) throw new Error('live snapshot requires sourceFile (project-relative .scene path)');
  return { tree, sourceFile: String(sourceFile).replace(/\\/g, '/'), dirty };
}

function assertNotTruncated(entry) {
  if (entry?.truncated) throw new Error('live snapshot is truncated (increase maxNodes/maxDepth and export again)');
  if (typeof entry?.childrenOmitted === 'number' && entry.childrenOmitted > 0) {
    throw new Error('live snapshot omitted children (increase maxNodes/maxDepth and export again)');
  }
}

function assertNodeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('treeToGraph: expected a node object');
  }
  if (entry.children !== undefined && !Array.isArray(entry.children)) {
    throw new Error('treeToGraph: node children must be an array');
  }
  assertNotTruncated(entry);
}

export function treeToGraph(root, { file, source = 'live' } = {}) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('treeToGraph: expected a node or children wrapper');
  }
  if (!file) throw new Error('treeToGraph: source file is required');
  assertNotTruncated(root);
  const hasRootIdentity = Boolean(root.reference?.id);
  const isWrapper = !('reference' in root) && Array.isArray(root.children);
  if (!hasRootIdentity && !isWrapper) {
    throw new Error('treeToGraph: top-level object must be a node or children wrapper');
  }
  if (root.children !== undefined && !Array.isArray(root.children)) {
    throw new Error('treeToGraph: node children must be an array');
  }

  const nodes = [];
  const comps = [];
  const refs = [];
  const identities = new Set();

  function walk(entry, parentHandle, parentPath) {
    assertNodeEntry(entry);
    const uuid = entry.reference?.id;
    if (typeof uuid !== 'string' || uuid.length === 0) {
      throw new Error('treeToGraph: node is missing reference identity');
    }
    if (identities.has(uuid)) throw new Error(`treeToGraph: duplicate node identity ${uuid}`);
    identities.add(uuid);

    const handle = makeHandle(file, uuid);
    const name = entry.name ?? '';
    const path = entry.path ?? (parentPath === '/' ? `/${name}` : `${parentPath}/${name}`);
    nodes.push({ handle, uuid, file, source, name, path, parent: parentHandle });

    if (entry.components !== undefined && !Array.isArray(entry.components)) {
      throw new Error('treeToGraph: node components must be an array');
    }
    for (const component of entry.components ?? []) {
      if (!component || typeof component !== 'object' || Array.isArray(component)) {
        throw new Error('treeToGraph: component must be an object');
      }
      const componentUuid = component.reference?.id;
      if (typeof componentUuid !== 'string' || componentUuid.length === 0) {
        throw new Error('treeToGraph: component is missing reference identity');
      }
      comps.push({
        handle: makeHandle(file, `component:${componentUuid}`),
        uuid: componentUuid,
        node: handle,
        nodeUuid: uuid,
        file,
        source,
        type: component.reference?.type ?? 'unknown',
        script: null,
      });
    }
    for (const child of entry.children ?? []) walk(child, handle, path);
  }

  if (hasRootIdentity) {
    walk(root, null, '/');
  } else {
    for (const child of root.children) walk(child, null, '/');
  }
  return { nodes, comps, refs, prefabOpaque: false };
}

export function validateLiveGraph(graph) {
  if (!Array.isArray(graph.nodes)) throw new Error('validateLiveGraph: missing nodes');
  const identities = new Set();
  const handles = new Set();
  for (const node of graph.nodes) {
    if (!node.uuid || !node.handle || !node.file) throw new Error('validateLiveGraph: node without identity provenance');
    if (identities.has(node.uuid) || handles.has(node.handle)) {
      throw new Error('validateLiveGraph: duplicate node identity or handle');
    }
    identities.add(node.uuid);
    handles.add(node.handle);
  }
  return true;
}
