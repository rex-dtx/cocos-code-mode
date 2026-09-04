import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(SLEEP, 0, 0, ms);

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx');
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try { renameSync(temp, path); }
  catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
}

export function acquireNamespaceLock(outDir, { timeoutMs = 5000, staleMs = 30000 } = {}) {
  mkdirSync(outDir, { recursive: true });
  const lockDir = join(outDir, '.build-lock');
  const ownerPath = join(lockDir, 'owner.json');
  const deadline = Date.now() + timeoutMs;
  const token = `${process.pid}:${randomUUID()}`;
  while (true) {
    try {
      mkdirSync(lockDir);
      writeFileSync(ownerPath, JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }), 'utf8');
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (readJson(ownerPath)?.token === token) rmSync(lockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = readJson(ownerPath);
      let lockCreatedAt = owner?.createdAt;
      if (!lockCreatedAt) {
        try { lockCreatedAt = statSync(lockDir).mtimeMs; } catch { continue; }
      }
      if (Date.now() - lockCreatedAt > staleMs && !isProcessAlive(owner?.pid)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`cocos-graph: timed out waiting for build lock ${lockDir}`);
      sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

export function removeUnreferencedGraphs(outDir, manifest, { graceMs = 60000 } = {}) {
  const keep = new Set((manifest?.shards ?? []).map((shard) => shard.graphFile).filter(Boolean));
  const now = Date.now();
  for (const shard of manifest?.shards ?? []) {
    const dir = join(outDir, shard.name);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = `${shard.name}/${name}`.replace(/\\/g, '/');
      if (!name.startsWith('graph-') || !name.endsWith('.json') || keep.has(rel)) continue;
      try {
        if (now - statSync(path).mtimeMs >= graceMs) unlinkSync(path);
      } catch {}
    }
  }
}
