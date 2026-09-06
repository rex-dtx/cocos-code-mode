import { createHash } from 'node:crypto';

export function fileSha256(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function fileFingerprint(stat) {
  return `${stat.size}:${stat.mtimeMs | 0}`;
}
