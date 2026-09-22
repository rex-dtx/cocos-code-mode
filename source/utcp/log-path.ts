import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export const DEBUG_LOG_ROOT_NAME = '.utcp-debug';
export const DEBUG_LOG_MAX_BYTES = 4 * 1024 * 1024;
export const DEBUG_LOG_RETENTION = 12;

export function logScope(value: unknown): string {
    const safe = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
    return safe || 'unscoped';
}

export function getDebugLogDirectory(instanceId?: unknown): string {
    const root = join(homedir(), DEBUG_LOG_ROOT_NAME);
    return typeof instanceId === 'string' && instanceId
        ? join(root, `instance-${logScope(instanceId)}`)
        : root;
}

function rotatedPath(file: string, index: number): string {
    return `${file.replace(/\.jsonl$/i, '')}-${index}.jsonl`;
}

function rotate(file: string): void {
    if (!existsSync(file)) return;
    for (let index = DEBUG_LOG_RETENTION - 1; index >= 1; index -= 1) {
        const source = rotatedPath(file, index);
        const target = rotatedPath(file, index + 1);
        if (!existsSync(source)) continue;
        try { if (existsSync(target)) unlinkSync(target); } catch {}
        try { renameSync(source, target); } catch {}
    }
    try { if (existsSync(rotatedPath(file, 1))) unlinkSync(rotatedPath(file, 1)); } catch {}
    try { renameSync(file, rotatedPath(file, 1)); } catch {}
}

export function createDebugLogFile(directory: string, kind: string, instanceId: string): string {
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${kind}-${logScope(instanceId)}-${Date.now()}-${logScope(process.pid)}.jsonl`);
    writeFileSync(file, '', { flag: 'a' });
    pruneDebugLogFiles(directory);
    return file;
}

export function appendJsonl(file: string, value: unknown): string {
    const line = JSON.stringify(value) + '\n';
    mkdirSync(dirname(file), { recursive: true });
    try {
        const currentBytes = existsSync(file) ? statSync(file).size : 0;
        if (currentBytes > 0 && currentBytes + Buffer.byteLength(line, 'utf8') > DEBUG_LOG_MAX_BYTES) rotate(file);
    } catch {}
    appendFileSync(file, line, { encoding: 'utf8' });
    return file;
}

export function listDebugLogFiles(directory: string): string[] {
    try {
        return readdirSync(directory)
            .filter((name) => name.endsWith('.jsonl'))
            .map((name) => join(directory, name))
            .sort((a, b) => {
                try { return statSync(b).mtimeMs - statSync(a).mtimeMs; } catch { return 0; }
            });
    } catch { return []; }
}

export function pruneDebugLogFiles(directory: string): void {
    const files = listDebugLogFiles(directory);
    for (const file of files.slice(DEBUG_LOG_RETENTION)) {
        try { unlinkSync(file); } catch {}
    }
}

export function clearDebugLogFiles(directory: string): number {
    let removed = 0;
    for (const file of listDebugLogFiles(directory)) {
        try { unlinkSync(file); removed += 1; } catch {}
    }
    return removed;
}
