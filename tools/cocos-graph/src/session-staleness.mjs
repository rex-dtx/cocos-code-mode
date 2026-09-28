import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PARSER_VERSION } from './manifest.mjs';
import { readJson } from './storage.mjs';
import { resolveInside } from './path-safety.mjs';
import { resolveGraphOutName } from './output-path.mjs';

export function resolveManifest({ cwd = process.cwd(), env = process.env, explicitOut = null } = {}) {
  const root = env.CC_PROJECT_DIR || process.cwd();
  const outName = explicitOut ?? env.CC_GRAPH_OUT ?? resolveGraphOutName({ isolate: env.CC_GRAPH_ISOLATE === '1', cwd });
  const manifestPath = join(root, outName, '_manifest.json');
  const manifest = readJson(manifestPath);
  return { manifest, outName, manifestPath };
}

export function validateSessionGraph({ cwd = process.cwd(), env = process.env, session, explicitOut = null } = {}) {
  const project = env.CC_PROJECT_DIR ?? session?.project;
  if (!project) return { stale: true, banner: ['no project in ccp-session.json — cannot locate _manifest.json'] };
  const outName = explicitOut ?? env.CC_GRAPH_OUT ?? resolveGraphOutName({ isolate: env.CC_GRAPH_ISOLATE === '1', cwd });
  const manifest = readJson(join(project, outName, '_manifest.json'));
  if (!manifest || !Array.isArray(manifest.shards)) return { stale: true, banner: [`index NOT BUILT (${outName})`] };
  if (manifest.parserVersion !== PARSER_VERSION) return { stale: true, banner: [`parserVersion ${manifest.parserVersion ?? 'missing'} is stale; ${PARSER_VERSION} required`] };
  if (!manifest.shards.some((shard) => shard.name === session.bundle)) return { stale: true, banner: [`no shard ${session.bundle}`] };
  const shard = manifest.shards.find((item) => item.name === session.bundle);
  if (shard.dirty === false && !shard.prefabOpaque) {
    if (!shard.graphFile) return { stale: true, banner: [`shard ${session.bundle} is stale or unreadable (parserVersion "${PARSER_VERSION}" expected, run build)`] };
    const graph = readJson(resolveInside(join(project, outName), shard.graphFile, 'manifest graphFile'));
    if (!graph) return { stale: true, banner: [`shard ${session.bundle} is stale or unreadable (parserVersion "${PARSER_VERSION}" expected, run build)`] };
    const { builtAt: _builtAt, manifestBuiltAt: _manifestBuiltAt, ...stable } = graph;
    const hash = createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
    if (graph.version !== PARSER_VERSION || graph.bundle !== session.bundle || shard.sha256 !== hash) {
      return { stale: true, banner: [`shard ${session.bundle} is stale or unreadable (parserVersion "${PARSER_VERSION}" expected, run build)`] };
    }
  }
  return { stale: shard.dirty !== false || !!shard.prefabOpaque, shard, manifest, outName };
}
