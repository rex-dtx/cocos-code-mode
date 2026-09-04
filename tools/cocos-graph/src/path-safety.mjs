import { isAbsolute, relative, resolve } from 'node:path';

export function assertBundleName(bundle) {
  if (typeof bundle !== 'string' || !bundle || bundle === '.' || bundle === '..' || /[\\/]/.test(bundle)) {
    throw new Error(`cocos-graph: invalid top-level bundle name "${bundle ?? ''}"`);
  }
  return bundle;
}

export function resolveInside(root, relativePath, label = 'path') {
  const target = resolve(root, relativePath);
  const rel = relative(resolve(root), target);
  if (!rel || rel === '.') return target;
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../')) {
    throw new Error(`cocos-graph: ${label} escapes cache root`);
  }
  return target;
}
