// Tree → graph adapter — live editor dump (nodeGetTree verbose) to the same
// per-shard shape as the disk parser. The live tree already contains prefab
// expansion; its `reference.id` is the stable `_id` (or fileId-derived for
// prefab children). No coordinate / property values are kept (T2 excluded).

export function treeToGraph(root) {
  if (!root || typeof root !== 'object') throw new Error('treeToGraph: expected the nodeGetTree result');
  // Top-level shape from the bridge: { reference, name?, children?, components?, path? }
  // Some calls wrap as { reference, children } only (no path); tolerate both.
  const nodes = [];
  const comps = [];
  const refs = [];
  function walk(entry, parentPath) {
    const uuid = entry.reference?.id;
    if (!uuid) return;
    const name = entry.name ?? '';
    const path = entry.path ?? (parentPath === '/' ? `/${name}` : `${parentPath}/${name}`);
    const parent = parentPath ? parentPath.split('/').filter(Boolean).pop() ?? null : null;
    // parent above is just a name hint; for live trees we store the path-derived parent uuid
    // via a second pass if needed — for the index, the `path` field is the canonical resolver.
    nodes.push({ uuid, name, path, parent });
    if (Array.isArray(entry.components)) {
      for (const c of entry.components) {
        const type = c.reference?.type ?? 'unknown';
        comps.push({ node: uuid, type, script: null });
        // Live refs (asset uses) stay variant — `asset-db query-asset-users` answers file→file;
        // the per-node `refs` layer for live trees is left to the bridge's own dump.
      }
    }
    if (Array.isArray(entry.children)) for (const child of entry.children) walk(child, path);
  }
  // The root holds the scene's only child as `children`; walk each
  const roots = Array.isArray(root.children) ? root.children : [root];
  for (const child of roots) walk(child, '/');
  return { nodes, comps, refs, prefabOpaque: false };
}

export function validateLiveGraph(graph) {
  if (!Array.isArray(graph.nodes)) throw new Error('validateLiveGraph: missing nodes');
  // Every node should have a uuid; fail loud on missing.
  for (const n of graph.nodes) if (!n.uuid) throw new Error('validateLiveGraph: node without uuid');
  return true;
}
