export const PARSER_VERSION = '3';

export function makeManifest(shards) {
  return {
    parserVersion: PARSER_VERSION,
    builtAt: Date.now(),
    shards: shards.map((s) => ({
      name: s.name,
      source: s.source,
      files: s.files,
      bytes: s.bytes,
      sha256: s.sha256 ?? null,
      prefabOpaque: !!s.prefabOpaque,
      ...(s.liveScene ? { liveScene: s.liveScene, liveNodes: s.liveNodes } : {}),
    })),
  };
}

export function isStale(manifest, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!manifest || !manifest.builtAt) return true;
  if (manifest.parserVersion !== PARSER_VERSION) return true;
  return Date.now() - manifest.builtAt > maxAgeMs;
}

export function shardAgeMs(manifest, bundle) {
  const s = manifest.shards.find((x) => x.name === bundle);
  if (!s) return null;
  return Date.now() - manifest.builtAt;
}
