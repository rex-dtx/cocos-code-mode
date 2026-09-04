export const PARSER_VERSION = '4';

export function makeManifest(shards, previous = null) {
  const byName = new Map((previous?.shards ?? []).map((shard) => [shard.name, shard]));
  for (const shard of shards) byName.set(shard.name, shard);
  return {
    parserVersion: PARSER_VERSION,
    builtAt: Date.now(),
    shards: [...byName.values()]
      .map((shard) => ({
        name: shard.name,
        source: shard.source,
        files: shard.files,
        bytes: shard.bytes,
        sha256: shard.sha256 ?? null,
        parsedFiles: shard.parsedFiles ?? null,
        reusedFiles: shard.reusedFiles ?? null,
        graphFile: shard.graphFile,
        builtAt: shard.builtAt ?? Date.now(),
        prefabOpaque: !!shard.prefabOpaque,
        dirty: shard.dirty ?? 'unknown',
        ...(shard.liveScene ? { liveScene: shard.liveScene, liveNodes: shard.liveNodes } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function isStale(manifest, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!manifest?.builtAt || manifest.parserVersion !== PARSER_VERSION) return true;
  return Date.now() - manifest.builtAt > maxAgeMs;
}

export function shardAgeMs(manifest, bundle) {
  const shard = manifest?.shards?.find((item) => item.name === bundle);
  if (!shard) return null;
  const builtAt = shard.builtAt ?? manifest.builtAt;
  return Number.isFinite(builtAt) ? Date.now() - builtAt : null;
}
