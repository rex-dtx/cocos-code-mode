import { makeHandle } from './parser.mjs';

export function unwrapLiveSnapshot(payload) {
  const tree = payload?.tree ?? payload;
  const sourceFile = payload?.sourceFile ?? payload?.file ?? tree?.sourceFile ?? null;
  const dirty = payload?.dirty === true || payload?.dirty === false ? payload.dirty : 'unknown';
  if (!sourceFile) throw new Error('live snapshot requires sourceFile (project-relative .fire path)');
  return { tree, sourceFile: String(sourceFile).replace(/\\/g, '/'), dirty };
}

function assertNotTruncated(entry) {
  if (entry?.budgetExhausted === true) throw new Error('live snapshot exhausted maxNodes (increase maxNodes and export again)');
  if (entry?.truncated === true || typeof entry?.truncated === 'string') throw new Error('live snapshot is truncated (increase maxNodes/maxDepth and export again)');
  if (typeof entry?.childrenOmitted === 'number' && entry.childrenOmitted > 0) throw new Error('live snapshot omitted children (increase maxNodes/maxDepth and export again)');
}

export function treeToGraph(root, { file, source = 'live' } = {}) {
  if (!root || typeof root !== 'object') throw new Error('treeToGraph: expected the sceneSnapshot result');
  if (!file) throw new Error('treeToGraph: source file is required');
  assertNotTruncated(root);
  const nodes = [];
  const comps = [];
  const refs = [];

  function walk(entry, parentHandle, parentPath) {
    assertNotTruncated(entry);
    const uuid = entry.reference?.id ?? entry.uuid;
    if (!uuid) throw new Error(`live snapshot node "${entry.name ?? 'unknown'}" has no UUID`);
    const handle = makeHandle(file, uuid);
    const name = entry.name ?? '';
    const path = entry.path ?? (parentPath === '/' ? `/${name}` : `${parentPath}/${name}`);
    nodes.push({ handle, uuid, file, source, name, path, parent: parentHandle });
    for (const component of Array.isArray(entry.components) ? entry.components : []) {
      const componentUuid = component.reference?.id ?? component.uuid ?? null;
      comps.push({
        handle: componentUuid ? makeHandle(file, `component:${componentUuid}`) : null,
        uuid: componentUuid,
        node: handle,
        nodeUuid: uuid,
        file,
        source,
        type: component.reference?.type ?? component.type ?? 'unknown',
        script: null,
      });
    }
    for (const child of Array.isArray(entry.children) ? entry.children : []) walk(child, handle, path);
  }

  const roots = Array.isArray(root.children) ? root.children : [root];
  for (const child of roots) walk(child, null, '/');
  return {
    nodes,
    comps,
    refs,
    prefabOpaque: false,
    serializedNodes: nodes.length,
    indexedNodes: nodes.length,
    omittedNodes: 0,
    serializedComponents: comps.length,
    indexedComponents: comps.length,
    omittedComponents: 0,
  };
}

export function validateLiveGraph(graph) {
  if (!Array.isArray(graph.nodes)) throw new Error('validateLiveGraph: missing nodes');
  for (const node of graph.nodes) {
    if (!node.uuid || !node.handle || !node.file) throw new Error('validateLiveGraph: node without identity provenance');
  }
  return true;
}
