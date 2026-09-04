import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

export function slugify(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function getWorktreeSlug({ cwd = process.cwd(), env = process.env, branch } = {}) {
  const explicit = slugify(env.CC_GRAPH_SLUG);
  if (explicit) return explicit;

  let detectedBranch = branch;
  if (detectedBranch === undefined) {
    try {
      detectedBranch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch {
      detectedBranch = null;
    }
  }

  const branchSlug = detectedBranch && detectedBranch !== 'HEAD' ? slugify(detectedBranch) : '';
  return branchSlug || slugify(basename(cwd)) || 'default';
}

export function resolveGraphOutName({ explicitOut, isolate = false, cwd = process.cwd(), env = process.env, branch } = {}) {
  if (explicitOut !== null && explicitOut !== undefined) return explicitOut;
  if (env.CC_GRAPH_OUT) return env.CC_GRAPH_OUT;
  if (isolate || env.CC_GRAPH_ISOLATE === '1') {
    return join('.cocos-graph', getWorktreeSlug({ cwd, env, branch }));
  }
  return '.cocos-graph';
}
